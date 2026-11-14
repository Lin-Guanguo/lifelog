import initSqlJs from 'sql.js'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockDav } from '../../test-support/webdav-mock'
import { createRecords, type Records } from '../data/records'
import { migrate } from '../data/schema'
import { fromSqliteFile } from '../data/snapshot'
import { configureSqlJs, loadSqlJs, sqlJsExecutor } from '../data/sqljs'
import type { HttpTransport } from './http'
import type { MediaFiles } from '../media/files'
import { downloadPhoto, REMOTE_FILE, sync, type SyncState } from './sync'
import { createWebDav, WebDavError, type WebDavConfig } from './webdav'

const CONFIG: WebDavConfig = { url: 'https://nas.example/dav', username: 'me', password: 'secret', directory: 'LifeLog/备份' }
const remotePath = '/dav/LifeLog/备份/lifelog.sqlite'
let server: ReturnType<typeof createMockDav>
let requests: string[]
let puts: string[] // paths, in upload order

function transport(): HttpTransport {
  return async ({ method, url, headers = {}, body }) => {
    requests.push(method)
    if (method === 'PUT') puts.push(decodeURIComponent(new URL(url).pathname))
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    return server.handle({ method, path: decodeURIComponent(new URL(url).pathname), headers: lower, body })
  }
}

// One shared, always-advancing clock, so "later" is well defined across devices.
let clock = Date.UTC(2026, 10, 9) // ids take their time part from the clock (ids.ts)

async function device(): Promise<Records> {
  const SQL = await loadSqlJs()
  const db = sqlJsExecutor(new SQL.Database())
  await migrate(db)
  return createRecords(db, () => ++clock)
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
  puts = []
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
    const all = vi.spyOn(phone, 'all')
    const result = await sync(dav, phone, state, false)
    expect(result.uploaded).toBe(false)
    expect(requests).toEqual(['PROPFIND'])
    expect(all).not.toHaveBeenCalled() // the log is not read either
  })

  it('replaces the remote file in place and removes a temp file left by older versions', async () => {
    const phone = await device()
    const dav = createWebDav(CONFIG, transport())
    let { state } = await sync(dav, phone, {}, true)
    server.files.set(`${remotePath}.uploading`, { body: new Uint8Array([1]), etag: 'stale', modified: '' })
    await phone.add('second')
    ;({ state } = await sync(dav, phone, state, true))
    await phone.add('third')
    ;({ state } = await sync(dav, phone, state, true))
    expect(await remoteLive()).toEqual(['second', 'third'])
    expect([...server.files.keys()]).toEqual([remotePath])
    expect(requests).not.toContain('MOVE')
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

    // Both sides agree; B's later edit is live and A's competing edit sits in the trash.
    expect(await contents(a)).toEqual(await contents(b))
    expect(await contents(b)).toEqual(['new on A', 'shared (B)'])
    expect((await b.listTrash()).trashed.map((r) => r.content).sort()).toEqual(['shared', 'shared (A)', 'to delete'])
    expect(await remoteLive()).toEqual(['new on A', 'shared (B)'])
    expect(stateA.remoteVersion).toBe(stateB.remoteVersion)
  })

  it('uploads referenced photo copies before the database, once each', async () => {
    const photo = (c: string) => `${c.repeat(32)}.webp`
    const files = memoryFiles({ [photo('a')]: [1], [photo('b')]: [2], [photo('c')]: [3] }) // c: imported, never sent
    const phone = await device()
    const dav = createWebDav(CONFIG, transport())
    await phone.add(`湖边\n\n![](media/${photo('a')})\n\n![](media/${photo('b')})`)
    let { state } = await sync(dav, phone, {}, true, undefined, 1000, files)

    const media = '/dav/LifeLog/备份/media/'
    expect([...server.files.keys()].sort()).toEqual([remotePath, `${media}${photo('a')}`, `${media}${photo('b')}`])
    expect(puts).toEqual([`${media}${photo('a')}`, `${media}${photo('b')}`, remotePath])

    // Already there: listed, not uploaded again. Trashed entries keep their photos.
    await phone.trashEntries((await phone.listLive()).map((r) => r.entry_id))
    requests = []
    ;({ state } = await sync(dav, phone, state, true, undefined, 2000, files))
    expect(requests.filter((m) => m === 'PUT')).toHaveLength(1)

    // Another device sees the entry and fetches a copy when it shows it.
    const laptop = await device()
    const laptopFiles = memoryFiles({})
    await sync(createWebDav(CONFIG, transport()), laptop, {}, false, undefined, 3000, laptopFiles)
    expect((await laptop.listTrash()).trashed).toHaveLength(1)
    expect(await downloadPhoto(dav, laptopFiles, photo('b'))).toBe(true)
    expect([...await laptopFiles.read(photo('b'))]).toEqual([2])
    expect(await downloadPhoto(dav, laptopFiles, photo('z'))).toBe(false) // not on the server
    expect(state.remoteVersion).toBeDefined()
  })

  it('deletes local copies no row references, but not recent ones, and never on the server', async () => {
    const photo = (c: string) => `${c.repeat(32)}.webp`
    const day = 24 * 3_600_000
    const now = Date.UTC(2026, 10, 12)
    const files = memoryFiles({ [photo('a')]: [1], [photo('b')]: [2], [photo('d')]: [4] }, now - 2 * day)
    files.add(photo('c'), now - 3_600_000) // added an hour ago, still in the composer's tray
    const phone = await device()
    const dav = createWebDav(CONFIG, transport())
    await phone.add(`kept\n\n![](media/${photo('a')})`)
    await phone.add(`trashed\n\n![](media/${photo('d')})`)
    let { state } = await sync(dav, phone, {}, true, undefined, now, files)
    expect(files.names()).toEqual([photo('a'), photo('c'), photo('d')]) // b: unused for two days
    const uploaded = [...server.files.keys()].filter((k) => k.includes('/media/')).length
    expect(uploaded).toBe(2) // a and d

    // Permanently deleting the entry frees its photo at the next sync.
    const trashed = (await phone.listLive()).find((r) => r.content.startsWith('trashed'))!
    await phone.trashEntries([trashed.entry_id])
    ;({ state } = await sync(dav, phone, state, true, undefined, now, files))
    expect(files.names()).toEqual([photo('a'), photo('c'), photo('d')]) // in the trash: still needed
    await phone.purge((await phone.listTrash()).trashed.map((r) => r.id))
    ;({ state } = await sync(dav, phone, state, true, undefined, now, files))
    expect(files.names()).toEqual([photo('a'), photo('c')])
    expect([...server.files.keys()].filter((k) => k.includes('/media/'))).toHaveLength(uploaded) // server untouched
  })

  it('keeps a photo added again just before it would be removed', async () => {
    const day = 24 * 3_600_000
    const now = Date.UTC(2026, 10, 12)
    const files = memoryFiles({ [`${'e'.repeat(32)}.jpg`]: [5] }, now - 2 * day)
    const list = files.list
    // Between listing and removing, the photo is added again (its date refreshed).
    files.list = async () => {
      const snapshot = await list()
      files.add(`${'e'.repeat(32)}.jpg`, now)
      return snapshot
    }
    await sync(createWebDav(CONFIG, transport()), await device(), {}, true, undefined, now, files)
    expect(files.names()).toEqual([`${'e'.repeat(32)}.jpg`])
  })

  it('without photos it makes no extra requests', async () => {
    const phone = await device()
    await phone.add('text only')
    await sync(createWebDav(CONFIG, transport()), phone, {}, true, undefined, 1000, memoryFiles({ [`${'c'.repeat(32)}.webp`]: [1] }))
    const withPhotos = requests
    requests = []
    server = createMockDav('me', 'secret')
    await sync(createWebDav(CONFIG, transport()), phone, {}, true, undefined, 1000)
    expect(withPhotos).toEqual(requests)
    expect([...server.dirs]).not.toContain('/dav/LifeLog/备份/media/')
  })

  it('reports bad credentials as an authentication error', async () => {
    const dav = createWebDav({ ...CONFIG, password: 'wrong' }, transport())
    await expect(sync(dav, await device(), {}, true)).rejects.toBeInstanceOf(WebDavError)
    await expect(dav.ensureDirectory()).rejects.toMatchObject({ status: 401 })
    expect(REMOTE_FILE).toBe('lifelog.sqlite')
  })
})

function memoryFiles(initial: Record<string, number[]>, modified = 0): MediaFiles & { names: () => string[]; add: (name: string, at: number) => void } {
  const files = new Map<string, { bytes: Uint8Array; modified: number }>(
    Object.entries(initial).map(([name, bytes]) => [name, { bytes: new Uint8Array(bytes), modified }]))
  return {
    list: async () => [...files].map(([name, f]) => ({ name, modified: f.modified })),
    read: async (name) => files.get(name)!.bytes,
    write: async (name, bytes) => { files.set(name, { bytes, modified: Date.now() }) },
    remove: async (name, keepSince) => {
      if (keepSince === undefined || files.get(name)!.modified < keepSince) files.delete(name)
    },
    names: () => [...files.keys()].sort(),
    add: (name, at) => { files.set(name, { bytes: new Uint8Array([0]), modified: at }) },
  }
}
