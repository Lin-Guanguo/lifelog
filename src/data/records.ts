export interface LogRecord {
  id: string
  entry_id: string
  logged_at: number
  content: string
  written_at: number
  deleted_at: number | null
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

function likePattern(query: string): string {
  return `%${query.replace(/[!%_]/g, (c) => `!${c}`)}%`
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(',')
}

export function createRecords(
  db: Executor,
  now: () => number = Date.now,
  uuid: () => string = () => crypto.randomUUID(),
) {
  const select = async (sql: string, values: unknown[] = []) => (await db.query(sql, values)) as unknown as LogRecord[]

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
      await db.run([{ statement: INSERT, values: [uuid(), uuid(), t, content, t] }])
    },

    async edit(current: LogRecord, content: string): Promise<void> {
      const t = now()
      await db.run([
        { statement: 'UPDATE records SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', values: [t, current.id] },
        { statement: INSERT, values: [uuid(), current.entry_id, current.logged_at, content, t] },
      ])
    },

    async trashEntries(entryIds: string[]): Promise<void> {
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
        ? await select(`SELECT * FROM records WHERE deleted_at IS NOT NULL AND content LIKE ? ESCAPE '!' ${order}`, [likePattern(query)])
        : await select(`SELECT * FROM records WHERE deleted_at IS NOT NULL ${order}`)
      const entryIds = [...new Set(trashed.map((r) => r.entry_id))]
      const live = entryIds.length
        ? await select(`SELECT * FROM records WHERE deleted_at IS NULL AND entry_id IN (${placeholders(entryIds)})`, entryIds)
        : []
      return { trashed, live }
    },

    async countTrash(): Promise<number> {
      const rows = await db.query('SELECT COUNT(*) AS n FROM records WHERE deleted_at IS NOT NULL')
      return Number(rows[0]?.n ?? 0)
    },

    // At most one row per entry may be restored; the entry's live row, if any, moves to the trash.
    async restore(rows: LogRecord[]): Promise<void> {
      if (new Set(rows.map((r) => r.entry_id)).size !== rows.length) {
        throw new Error('restore: more than one row for the same entry')
      }
      if (rows.length === 0) return
      const t = now()
      await db.run(rows.flatMap((r) => [
        { statement: 'UPDATE records SET deleted_at = ? WHERE entry_id = ? AND deleted_at IS NULL', values: [t, r.entry_id] },
        { statement: 'UPDATE records SET deleted_at = NULL WHERE id = ?', values: [r.id] },
      ]))
    },

    async purge(ids: string[]): Promise<void> {
      if (ids.length === 0) return
      await db.run([{
        statement: `DELETE FROM records WHERE deleted_at IS NOT NULL AND id IN (${placeholders(ids)})`,
        values: ids,
      }])
    },

    // Every row, live and trashed, for snapshots.
    all(): Promise<LogRecord[]> {
      return select('SELECT * FROM records ORDER BY logged_at, written_at')
    },

    // Merges another copy of the log. Rows are immutable except deleted_at, so:
    // rows missing here are added, a deletion on either side wins, and a row that would give an
    // entry a second live text (edited on both sides) is added to the trash instead of being lost.
    // Resolves to true when local data changed.
    async merge(rows: LogRecord[]): Promise<boolean> {
      if (rows.length === 0) return false
      const t = now()
      const insert = 'INSERT OR IGNORE INTO records (id, entry_id, logged_at, content, written_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)'
      const deletions = rows.filter((r) => r.deleted_at !== null).map((r) => ({
        statement: 'UPDATE records SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL',
        values: [r.deleted_at, r.id],
      }))
      // The second insert only applies when the first was rejected by the one-live-row index.
      const inserts = rows.flatMap((r) => [
        { statement: insert, values: [r.id, r.entry_id, r.logged_at, r.content, r.written_at, r.deleted_at] },
        { statement: insert, values: [r.id, r.entry_id, r.logged_at, r.content, r.written_at, r.deleted_at ?? t] },
      ])
      return (await db.run([...deletions, ...inserts])) > 0
    },

    // retentionHours <= 0 means never clear.
    async purgeExpired(retentionHours: number): Promise<void> {
      if (retentionHours <= 0) return
      await db.run([{
        statement: 'DELETE FROM records WHERE deleted_at IS NOT NULL AND deleted_at < ?',
        values: [now() - retentionHours * HOUR_MS],
      }])
    },
  }
}

export type Records = ReturnType<typeof createRecords>

// Milliseconds until a trashed row is cleared; null when cleanup is off.
export function timeLeft(deletedAt: number, retentionHours: number, now = Date.now()): number | null {
  if (retentionHours <= 0) return null
  return Math.max(0, deletedAt + retentionHours * HOUR_MS - now)
}
