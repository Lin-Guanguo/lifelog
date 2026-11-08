import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import { createRecords, type Executor, type Records } from './records'
import { migrate } from './schema'

const DB_NAME = 'lifelog'

// onChange runs after every committed write, so sync can tell local data changed.
export async function openRecords(onChange: () => void = () => {}): Promise<Records> {
  const isWeb = Capacitor.getPlatform() === 'web'
  const sqlite = new SQLiteConnection(CapacitorSQLite)
  if (isWeb) {
    const { defineCustomElements } = await import('jeep-sqlite/loader')
    await defineCustomElements(window)
    document.body.appendChild(document.createElement('jeep-sqlite'))
    await customElements.whenDefined('jeep-sqlite')
    await sqlite.initWebStore()
  }
  // The plugin's own version/upgrade mechanism is unused; schema.ts manages user_version.
  const conn = await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false)
  await conn.open()

  // The web build keeps SQLite in memory; changes reach IndexedDB only when saved.
  const persist = async () => {
    if (isWeb) await sqlite.saveToStore(DB_NAME)
  }

  const executor: Executor = {
    async query(sql, values = []) {
      return (await conn.query(sql, values)).values ?? []
    },
    async run(statements) {
      const result = await conn.executeSet(statements, true)
      await persist()
      const changed = result.changes?.changes ?? 1
      if (changed > 0) onChange()
      return changed
    },
    async exec(statements) {
      // The plugin splits a script on ";\n".
      await conn.execute(statements.join(';\n'), true)
      await persist()
    },
  }
  await migrate(executor)
  return createRecords(executor)
}
