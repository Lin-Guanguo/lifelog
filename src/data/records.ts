import { makeId } from './ids'

export interface LogRecord {
  id: number // see ids.ts
  entry_id: number // id of the entry's first row
  logged_at: number
  content: string
  written_at: number
  deleted_at: number | null
  purged_at: number | null // permanently deleted: content is '' and the row stays as a tombstone
}

export interface Statement {
  statement: string
  values: unknown[]
}

// Minimal SQL surface, implemented by the Capacitor plugin in the app and by sql.js in tests.
export interface Executor {
  query(sql: string, values?: unknown[]): Promise<Record<string, unknown>[]>
  // Runs all parameterized statements in one transaction; resolves to the number of changed rows.
  run(statements: Statement[]): Promise<number>
  // Runs plain SQL statements (DDL, PRAGMA) in one transaction.
  exec(statements: string[]): Promise<void>
}

export const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS

const INSERT = 'INSERT INTO records (id, entry_id, logged_at, content, written_at) VALUES (?, ?, ?, ?, ?)'
const IN_TRASH = 'deleted_at IS NOT NULL AND purged_at IS NULL'
const PURGE = "UPDATE records SET content = '', purged_at = ?"

const earliest = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b))

function likePattern(query: string): string {
  return `%${query.replace(/[!%_]/g, (c) => `!${c}`)}%`
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(',')
}

export function createRecords(
  db: Executor,
  now: () => number = Date.now,
  random: () => number = Math.random,
) {
  const select = async (sql: string, values: unknown[] = []) => (await db.query(sql, values)) as unknown as LogRecord[]

  // Strictly increasing on this device, so rows made in the same millisecond (or after the clock
  // moved back) never collide; other devices differ by the random low bits.
  let lastId: number | undefined
  async function newId(time: number): Promise<number> {
    lastId ??= Number((await db.query('SELECT MAX(id) AS id FROM records'))[0]?.id ?? 0)
    lastId = Math.max(makeId(time, Math.floor(random() * 4096)), lastId + 1)
    return lastId
  }

  return {
    listLive(): Promise<LogRecord[]> {
      return select('SELECT * FROM records WHERE deleted_at IS NULL ORDER BY logged_at, written_at')
    },

    searchLive(query: string): Promise<LogRecord[]> {
      return select(
        "SELECT * FROM records WHERE deleted_at IS NULL AND content LIKE ? ESCAPE '!' ORDER BY logged_at DESC",
        [likePattern(query)],
      )
    },

    async add(content: string): Promise<void> {
      const t = now()
      const id = await newId(t)
      await db.run([{ statement: INSERT, values: [id, id, t, content, t] }])
    },

    async edit(current: LogRecord, content: string): Promise<void> {
      const t = now()
      await db.run([
        { statement: 'UPDATE records SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', values: [t, current.id] },
        { statement: INSERT, values: [await newId(t), current.entry_id, current.logged_at, content, t] },
      ])
    },

    async trashEntries(entryIds: number[]): Promise<void> {
      if (entryIds.length === 0) return
      await db.run([{
        statement: `UPDATE records SET deleted_at = ? WHERE deleted_at IS NULL AND entry_id IN (${placeholders(entryIds)})`,
        values: [now(), ...entryIds],
      }])
    },

    // Trashed rows (optionally filtered) plus the live rows of the same entries, for reference.
    async listTrash(query = ''): Promise<{ trashed: LogRecord[]; live: LogRecord[] }> {
      const order = 'ORDER BY logged_at DESC, written_at DESC'
      const trashed = query
        ? await select(`SELECT * FROM records WHERE ${IN_TRASH} AND content LIKE ? ESCAPE '!' ${order}`, [likePattern(query)])
        : await select(`SELECT * FROM records WHERE ${IN_TRASH} ${order}`)
      const entryIds = [...new Set(trashed.map((r) => r.entry_id))]
      const live = entryIds.length
        ? await select(`SELECT * FROM records WHERE deleted_at IS NULL AND entry_id IN (${placeholders(entryIds)})`, entryIds)
        : []
      return { trashed, live }
    },

    async countTrash(): Promise<number> {
      const rows = await db.query(`SELECT COUNT(*) AS n FROM records WHERE ${IN_TRASH}`)
      return Number(rows[0]?.n ?? 0)
    },

    // At most one row per entry may be restored. Restoring appends a new live row with the same text
    // and time; the entry's current text moves to the trash and the restored trash row is purged.
    async restore(rows: LogRecord[]): Promise<void> {
      if (new Set(rows.map((r) => r.entry_id)).size !== rows.length) {
        throw new Error('restore: more than one row for the same entry')
      }
      if (rows.some((r) => r.deleted_at === null || r.purged_at !== null)) throw new Error('restore: not in the trash')
      if (rows.length === 0) return
      const t = now()
      const ids: number[] = []
      for (let i = 0; i < rows.length; i++) ids.push(await newId(t))
      await db.run(rows.flatMap((r, i) => [
        { statement: 'UPDATE records SET deleted_at = ? WHERE entry_id = ? AND deleted_at IS NULL', values: [t, r.entry_id] },
        { statement: INSERT, values: [ids[i], r.entry_id, r.logged_at, r.content, t] },
        { statement: `${PURGE} WHERE id = ? AND purged_at IS NULL`, values: [t, r.id] },
      ]))
    },

    // Permanent deletion of trash rows: their content is erased, the rows stay as tombstones.
    async purge(ids: number[]): Promise<void> {
      if (ids.length === 0) return
      await db.run([{ statement: `${PURGE} WHERE ${IN_TRASH} AND id IN (${placeholders(ids)})`, values: [now(), ...ids] }])
    },

    // Every row, including tombstones, for snapshots.
    all(): Promise<LogRecord[]> {
      return select('SELECT * FROM records ORDER BY logged_at, written_at')
    },

    // Merges another copy of the log; resolves to whether anything changed here. Rows are append-only
    // and only move forward (live → trashed → purged), so per row id the copy further along wins, with
    // the earlier time when both are. If an entry ends up with two live texts (edited on two devices),
    // the later-written one stays live and the other is trashed as of that time, the same on every copy.
    async merge(remote: LogRecord[]): Promise<boolean> {
      const rows = new Map((await select('SELECT * FROM records')).map((r) => [r.id, r]))
      const liveByEntry = new Map([...rows.values()].filter((r) => r.deleted_at === null).map((r) => [r.entry_id, r]))
      const statements: Statement[] = []
      const update = (row: LogRecord, deletedAt: number | null, purgedAt: number | null) => {
        if (deletedAt === row.deleted_at && purgedAt === row.purged_at) return
        statements.push({
          statement: "UPDATE records SET deleted_at = ?, purged_at = ?, content = CASE WHEN ? IS NULL THEN content ELSE '' END WHERE id = ?",
          values: [deletedAt, purgedAt, purgedAt, row.id],
        })
        if (row.deleted_at === null && deletedAt !== null) liveByEntry.delete(row.entry_id)
        rows.set(row.id, { ...row, deleted_at: deletedAt, purged_at: purgedAt, content: purgedAt === null ? row.content : '' })
      }

      // Rows known here first, so status changes are in place before new texts compete for live.
      const known = remote.filter((r) => rows.has(r.id))
      for (const r of known) {
        const local = rows.get(r.id)!
        const purgedAt = earliest(local.purged_at, r.purged_at)
        update(local, earliest(local.deleted_at, r.deleted_at) ?? purgedAt, purgedAt)
      }
      for (const r of remote) {
        if (rows.has(r.id)) continue
        // A purged row is always deleted, even if a malformed copy says otherwise.
        let row: LogRecord = { ...r, content: r.purged_at === null ? r.content : '', deleted_at: r.deleted_at ?? r.purged_at }
        if (row.deleted_at === null) {
          const live = liveByEntry.get(row.entry_id)
          const newer = !live || row.written_at > live.written_at || (row.written_at === live.written_at && row.id > live.id)
          if (live && newer) update(live, row.written_at, null)
          if (newer) liveByEntry.set(row.entry_id, row)
          else row = { ...row, deleted_at: live!.written_at }
        }
        statements.push({
          statement: 'INSERT INTO records (id, entry_id, logged_at, content, written_at, deleted_at, purged_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          values: [row.id, row.entry_id, row.logged_at, row.content, row.written_at, row.deleted_at, row.purged_at],
        })
        rows.set(row.id, row)
      }
      if (statements.length === 0) return false
      await db.run(statements)
      lastId = undefined // new ids continue above whatever arrived
      return true
    },

    // Trash older than the retention is purged (content erased, tombstone kept). retentionHours <= 0 means never.
    async purgeExpired(retentionHours: number): Promise<void> {
      if (retentionHours <= 0) return
      await db.run([{ statement: `${PURGE} WHERE ${IN_TRASH} AND deleted_at < ?`, values: [now(), now() - retentionHours * HOUR_MS] }])
    },
  }
}

export type Records = ReturnType<typeof createRecords>

// Milliseconds until a trashed row is cleared; null when cleanup is off.
export function timeLeft(deletedAt: number, retentionHours: number, now = Date.now()): number | null {
  if (retentionHours <= 0) return null
  return Math.max(0, deletedAt + retentionHours * HOUR_MS - now)
}
