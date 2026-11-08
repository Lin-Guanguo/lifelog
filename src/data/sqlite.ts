import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import { createRecords, SCHEMA, type Executor, type Records } from './records'

const DB_NAME = 'lifelog'

export async function openRecords(): Promise<Records> {
  const isWeb = Capacitor.getPlatform() === 'web'
  const sqlite = new SQLiteConnection(CapacitorSQLite)
  if (isWeb) {
    const { defineCustomElements } = await import('jeep-sqlite/loader')
    await defineCustomElements(window)
    document.body.appendChild(document.createElement('jeep-sqlite'))
    await customElements.whenDefined('jeep-sqlite')
    await sqlite.initWebStore()
  }
  const conn = await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false)
  await conn.open()
  await conn.execute(SCHEMA, false)

  // The web build keeps SQLite in memory; changes reach IndexedDB only when saved.
  const persist = async () => {
    if (isWeb) await sqlite.saveToStore(DB_NAME)
  }
  await persist()

  const executor: Executor = {
    async query(sql, values = []) {
      return (await conn.query(sql, values)).values ?? []
    },
    async run(statements) {
      await conn.executeSet(statements, true)
      await persist()
    },
  }
  return createRecords(executor)
}
