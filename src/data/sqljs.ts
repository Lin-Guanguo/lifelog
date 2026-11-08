import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import type { Executor } from './records'

let loader: () => Promise<SqlJsStatic> = () => initSqlJs({ locateFile: (file) => `/assets/${file}` })
let instance: Promise<SqlJsStatic> | undefined

// Tests run in Node, where sql.js finds its wasm on its own.
export function configureSqlJs(load: () => Promise<SqlJsStatic>): void {
  loader = load
  instance = undefined
}

export function loadSqlJs(): Promise<SqlJsStatic> {
  instance ??= loader()
  return instance
}

export function sqlJsExecutor(db: Database): Executor {
  const transaction = (body: () => void) => {
    db.exec('BEGIN')
    try {
      body()
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return {
    async query(sql, values = []) {
      const stmt = db.prepare(sql)
      try {
        stmt.bind(values as never[])
        const rows: Record<string, unknown>[] = []
        while (stmt.step()) rows.push(stmt.getAsObject())
        return rows
      } finally {
        stmt.free()
      }
    },
    async run(statements) {
      let changed = 0
      transaction(() => statements.forEach((s) => {
        db.run(s.statement, s.values as never[])
        changed += db.getRowsModified()
      }))
      return changed
    },
    async exec(statements) {
      transaction(() => statements.forEach((s) => db.run(s)))
    },
  }
}
