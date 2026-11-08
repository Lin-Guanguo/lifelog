import type { Executor } from './records'

// Ordered schema migrations; MIGRATIONS[i] upgrades the database from version i to i + 1.
// The version lives in SQLite's standard `PRAGMA user_version`, so any SQLite tool can read it.
// Never edit a shipped migration: append a new one.
export const MIGRATIONS: string[][] = [
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
]

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
    await db.exec([...MIGRATIONS[version], `PRAGMA user_version = ${version + 1}`])
  }
}
