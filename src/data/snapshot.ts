import { createRecords, type LogRecord } from './records'
import { migrate } from './schema'
import { loadSqlJs, sqlJsExecutor } from './sqljs'

// A snapshot is a standalone SQLite file with the current schema and every row (live and trashed),
// readable by any SQLite tool.
export async function toSqliteFile(rows: LogRecord[]): Promise<Uint8Array> {
  const SQL = await loadSqlJs()
  const db = new SQL.Database()
  try {
    const executor = sqlJsExecutor(db)
    await migrate(executor)
    await createRecords(executor).merge(rows)
    return db.export()
  } finally {
    db.close()
  }
}

// Older snapshots are migrated in memory; newer ones throw NewerSchemaError.
export async function fromSqliteFile(bytes: Uint8Array): Promise<LogRecord[]> {
  const SQL = await loadSqlJs()
  const db = new SQL.Database(bytes)
  try {
    const executor = sqlJsExecutor(db)
    await migrate(executor)
    return await createRecords(executor).all()
  } finally {
    db.close()
  }
}
