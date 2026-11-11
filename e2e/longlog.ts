import initSqlJs from 'sql.js'
import { createRecords } from '../src/data/records'
import { migrate } from '../src/data/schema'
import { sqlJsExecutor } from '../src/data/sqljs'

// A long log as a synced SQLite file, put on the mock WebDAV server (test-support/webdav-server.ts) for a fresh app to
// merge: entries "条目 #0001" … one hour apart from 2026-10-01.
export const DAV = 'http://127.0.0.1:5300/dav/'
const AUTH = `Basic ${Buffer.from('me:secret').toString('base64')}`
export const entryName = (n: number) => `条目 #${String(n).padStart(4, '0')}`

export async function putLongLog(folder: string, count: number): Promise<void> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  const executor = sqlJsExecutor(db)
  await migrate(executor)
  let clock = Date.UTC(2026, 9, 1)
  const records = createRecords(executor, () => (clock += 3_600_000))
  for (let n = 1; n <= count; n++) await records.add(entryName(n))
  await fetch(`${DAV}${folder}/`, { method: 'MKCOL', headers: { Authorization: AUTH } })
  const put = await fetch(`${DAV}${folder}/lifelog.sqlite`, { method: 'PUT', headers: { Authorization: AUTH }, body: db.export() })
  if (!put.ok) throw new Error(`PUT → ${put.status}`)
}
