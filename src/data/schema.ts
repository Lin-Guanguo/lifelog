import { hash12, makeId } from './ids'
import type { Executor } from './records'

// Ordered schema migrations; MIGRATIONS[i] upgrades the database from version i to i + 1.
// The version lives in SQLite's standard `PRAGMA user_version`, so any SQLite tool can read it.
// Never edit a shipped migration: append a new one.
// A step is plain SQL (run in one transaction with its version bump) or a function for data
// conversions, which must be safe to re-run and set user_version in its own final transaction.
type Migration = string[] | ((db: Executor) => Promise<void>)

export const MIGRATIONS: Migration[] = [
  // v1: one row per saved text. Content is never modified: an edit soft-deletes the old row
  // and inserts a new one with the same entry_id and logged_at. IF NOT EXISTS keeps databases
  // created before versioning (user_version 0, table already present) intact.
  [
    `CREATE TABLE IF NOT EXISTS records (
      id          TEXT PRIMARY KEY,
      entry_id    TEXT NOT NULL,
      logged_at   INTEGER NOT NULL,
      content     TEXT NOT NULL,
      written_at  INTEGER NOT NULL,
      deleted_at  INTEGER
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS records_one_live ON records(entry_id) WHERE deleted_at IS NULL',
    'CREATE INDEX IF NOT EXISTS records_timeline ON records(logged_at) WHERE deleted_at IS NULL',
  ],
  migrateToV2,
  // v3: the timeline is read in pages, ordered by (logged_at, id); the index serves both the order and the page bounds.
  [
    'DROP INDEX IF EXISTS records_timeline',
    'CREATE INDEX records_timeline ON records(logged_at, id) WHERE deleted_at IS NULL',
  ],
]

// v2: integer ids (see ids.ts) and purged_at. Permanent deletion keeps the row as a tombstone
// (content '', purged_at set) so sync can tell other copies it is gone; rows only move forward:
// live → trashed → purged. Text ids convert deterministically (time from the row, low bits from
// a hash of the old id), so every device and every old backup converts to the same numbers.
// The entry's first row (written_at = logged_at) takes the entry's number, so entry_id = first row id.
async function migrateToV2(db: Executor): Promise<void> {
  const old = (await db.query('SELECT * FROM records')) as {
    id: string; entry_id: string; logged_at: number; content: string; written_at: number; deleted_at: number | null
  }[]
  const used = new Set<number>()
  const unique = (time: number, key: string) => {
    let id = makeId(time, hash12(key))
    for (let salt = 1; used.has(id); salt++) id = makeId(time, hash12(`${key}#${salt}`))
    used.add(id)
    return id
  }
  const entryIds = new Map<string, number>()
  for (const r of old) if (!entryIds.has(r.entry_id)) entryIds.set(r.entry_id, unique(r.logged_at, r.entry_id))
  const rows = old.map((r) => {
    const entryId = entryIds.get(r.entry_id)!
    const isFirst = r.written_at === r.logged_at && !old.some((o) => o !== r && o.entry_id === r.entry_id && o.written_at === r.written_at)
    return [isFirst ? entryId : unique(r.written_at, r.id), entryId, r.logged_at, r.content, r.written_at, r.deleted_at]
  })

  // Interrupted runs leave records untouched (user_version 1) and start over here.
  await db.exec([
    'DROP TABLE IF EXISTS records_v2',
    `CREATE TABLE records_v2 (
      id          INTEGER PRIMARY KEY,
      entry_id    INTEGER NOT NULL,
      logged_at   INTEGER NOT NULL,
      content     TEXT NOT NULL,
      written_at  INTEGER NOT NULL,
      deleted_at  INTEGER,
      purged_at   INTEGER
    )`,
  ])
  if (rows.length) {
    await db.run(rows.map((values) => ({
      statement: 'INSERT INTO records_v2 (id, entry_id, logged_at, content, written_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)',
      values,
    })))
  }
  await db.exec([
    'DROP TABLE records',
    'ALTER TABLE records_v2 RENAME TO records',
    'CREATE UNIQUE INDEX records_one_live ON records(entry_id) WHERE deleted_at IS NULL',
    'CREATE INDEX records_timeline ON records(logged_at) WHERE deleted_at IS NULL',
    'PRAGMA user_version = 2',
  ])
}

export const SCHEMA_VERSION = MIGRATIONS.length

export class NewerSchemaError extends Error {
  readonly found: number

  constructor(found: number) {
    super(`database schema v${found} is newer than this app supports (v${SCHEMA_VERSION})`)
    this.found = found
  }
}

export async function schemaVersion(db: Executor): Promise<number> {
  const rows = await db.query('PRAGMA user_version')
  return Number(rows[0]?.user_version ?? 0)
}

// Brings the database to SCHEMA_VERSION; each step runs in its own transaction together
// with its version bump, so an interrupted upgrade resumes from the last completed step.
export async function migrate(db: Executor): Promise<void> {
  const current = await schemaVersion(db)
  if (current > SCHEMA_VERSION) throw new NewerSchemaError(current)
  for (let version = current; version < SCHEMA_VERSION; version++) {
    const step = MIGRATIONS[version]
    if (typeof step === 'function') await step(db)
    else await db.exec([...step, `PRAGMA user_version = ${version + 1}`])
  }
}
