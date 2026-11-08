import initSqlJs from 'sql.js'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createMockDav } from '../../test-support/webdav-mock'
import { createRecords, type Records } from '../data/records'
import { migrate } from '../data/schema'
import { fromSqliteFile } from '../data/snapshot'
import { configureSqlJs, loadSqlJs, sqlJsExecutor } from '../data/sqljs'
import type { HttpTransport } from './http'
import { REMOTE_FILE, sync, type SyncState } from './sync'
import { createWebDav, WebDavError, type WebDavConfig } from './webdav'

const CONFIG: WebDavConfig = { url: 'https://nas.example/dav', username: 'me', password: 'secret', directory: 'LifeLog/备份' }
const remotePath = '/dav/LifeLog/备份/lifelog.sqlite'
let server: ReturnType<typeof createMockDav>
let requests: string[]

function transport(): HttpTransport {
  return async ({ method, url, headers = {}, body }) => {
    requests.push(method)
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    return server.handle({ method, path: decodeURIComponent(new URL(url).pathname), headers: lower, body })
  }
}

async function device(): Promise<Records> {
  const SQL = await loadSqlJs()
  const db = sqlJsExecutor(new SQL.Database())
  await migrate(db)
  return createRecords(db)
}

async function remoteLive(): Promise<string[]> {
  const rows = await fromSqliteFile(server.files.get(remotePath)!.body)
  return rows.filter((r) => r.deleted_at === null).map((r) => r.content).sort()
}

const contents = async (records: Records) => (await records.listLive()).map((r) => r.content).sort()

beforeAll(async () => {
  const SQL = await initSqlJs()
  configureSqlJs(async () => SQL)
})

beforeEach(() => {
  server = createMockDav('me', 'secret')
  requests = []
})

describe('sync', () => {
  it('first sync creates the folder and uploads a readable SQLite snapshot', async () => {
    const phone = await device()
    await phone.add('卧推 60 公斤')
    const result = await sync(createWebDav(CONFIG, transport()), phone, {}, true, undefined, 1000)

    expect(server.dirs.has('/dav/LifeLog/备份/')).toBe(true)
    expect(server.files.has(`${remotePath}.uploading`)).toBe(false)
    expect(await remoteLive()).toEqual(['卧推 60 公斤'])
    expect(result).toEqual({ state: { remoteVersion: expect.any(String), lastSyncAt: 1000 }, merged: false, uploaded: true })
  })

  it('with nothing new on either side it only checks the remote version', async () => {
    const phone = await device()
    const dav = createWebDav(CONFIG, transport())
    const { state } = await sync(dav, phone, {}, true)
    requests = []
    const result = await sync(dav, phone, state, false)
    expect(result.uploaded).toBe(false)
    expect(requests).toEqual(['PROPFIND'])
  })

  it('uploads local changes when the remote is unchanged', async () => {
    const phone = await device()
    const dav = createWebDav(CONFIG, transport())
    let { state } = await sync(dav, phone, {}, true)
    await phone.add('second')
    ;({ state } = await sync(dav, phone, state, true))
    expect(await remoteLive()).toEqual(['second'])
  })

  it('a fresh install merges the existing backup instead of overwriting it', async () => {
    const oldPhone = await device()
    await oldPhone.add('from the old phone')
    await sync(createWebDav(CONFIG, transport()), oldPhone, {}, true)

    const newPhone = await device()
    await newPhone.add('from the new phone')
    const result = await sync(createWebDav(CONFIG, transport()), newPhone, {}, true)

    expect(result.merged).toBe(true)
    expect(await contents(newPhone)).toEqual(['from the new phone', 'from the old phone'])
    expect(await remoteLive()).toEqual(['from the new phone', 'from the old phone'])
  })

  it('two devices converge: edits, deletions and new entries from both sides', async () => {
    const a = await device()
    const davA = createWebDav(CONFIG, transport())
    await a.add('shared')
    await a.add('to delete')
    let stateA: SyncState = (await sync(davA, a, {}, true)).state

    const b = await device()
    const davB = createWebDav(CONFIG, transport())
    let stateB: SyncState = (await sync(davB, b, {}, false)).state
    expect(await contents(b)).toEqual(['shared', 'to delete'])

    // A edits "shared" and adds an entry; B edits "shared" differently and deletes "to delete".
    await a.edit((await a.listLive()).find((r) => r.content === 'shared')!, 'shared (A)')
    await a.add('new on A')
    stateA = (await sync(davA, a, stateA, true)).state
    const bLive = await b.listLive()
    await b.edit(bLive.find((r) => r.content === 'shared')!, 'shared (B)')
    await b.trashEntries([bLive.find((r) => r.content === 'to delete')!.entry_id])
    stateB = (await sync(davB, b, stateB, true)).state
    stateA = (await sync(davA, a, stateA, false)).state
    // B has nothing new: it adopts A's upload instead of re-uploading (no ping-pong).
    const settle = await sync(davB, b, stateB, false)
    expect(settle).toMatchObject({ merged: false, uploaded: false })
    stateB = settle.state

    // Both sides agree; B kept its own edit live and A's competing edit sits in the trash.
    expect(await contents(a)).toEqual(await contents(b))
    expect(await contents(b)).toEqual(['new on A', 'shared (B)'])
    expect((await b.listTrash()).trashed.map((r) => r.content).sort()).toEqual(['shared', 'shared (A)', 'to delete'])
    expect(await remoteLive()).toEqual(['new on A', 'shared (B)'])
    expect(stateA.remoteVersion).toBe(stateB.remoteVersion)
  })

  it('reports bad credentials as an authentication error', async () => {
    const dav = createWebDav({ ...CONFIG, password: 'wrong' }, transport())
    await expect(sync(dav, await device(), {}, true)).rejects.toBeInstanceOf(WebDavError)
    await expect(dav.ensureDirectory()).rejects.toMatchObject({ status: 401 })
    expect(REMOTE_FILE).toBe('lifelog.sqlite')
  })
})
