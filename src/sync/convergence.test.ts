import initSqlJs from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { createMockDav } from '../../test-support/webdav-mock'
import { createRecords, type LogRecord, type Records } from '../data/records'
import { migrate } from '../data/schema'
import { fromSqliteFile } from '../data/snapshot'
import { configureSqlJs, loadSqlJs, sqlJsExecutor } from '../data/sqljs'
import type { HttpTransport } from './http'
import { sync, type SyncState } from './sync'
import { createWebDav } from './webdav'

// Two devices doing random operations and syncing in random order must end up identical,
// with at most one live text per entry and no purged text anywhere, including the remote file.

beforeAll(async () => {
  const SQL = await initSqlJs()
  configureSqlJs(async () => SQL)
})

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
}

interface Device { records: Records; state: SyncState; dirty: boolean }

async function run(seed: number) {
  const random = rng(seed)
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]
  let clock = Date.UTC(2026, 10, 9) // ids take their time part from the clock (ids.ts)
  const server = createMockDav('me', 'secret')
  const transport: HttpTransport = async ({ method, url, headers = {}, body }) => server.handle({
    method, path: decodeURIComponent(new URL(url).pathname), body,
    headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
  })
  const dav = createWebDav({ url: 'https://dav.test/dav', username: 'me', password: 'secret', directory: 'lifelog' }, transport)
  const SQL = await loadSqlJs()
  const devices: Device[] = []
  for (let i = 0; i < 2; i++) {
    const db = sqlJsExecutor(new SQL.Database())
    await migrate(db)
    devices.push({ records: createRecords(db, () => ++clock, random), state: {}, dirty: false })
  }
  const purgedTexts = new Set<string>()
  let texts = 0

  const syncDevice = async (d: Device) => {
    d.state = (await sync(dav, d.records, d.state, d.dirty)).state
    d.dirty = false
  }

  for (let step = 0; step < 120; step++) {
    const d = pick(devices)
    const live = await d.records.listLive()
    const { trashed } = await d.records.listTrash()
    const op = random()
    if (op < 0.25) {
      await d.records.add(`<t${++texts}>`)
    } else if (op < 0.4 && live.length) {
      await d.records.edit(pick(live), `<t${++texts}>`)
    } else if (op < 0.5 && live.length) {
      await d.records.trashEntries([pick(live).entry_id])
    } else if (op < 0.6 && trashed.length) {
      await d.records.restore([pick(trashed)])
    } else if (op < 0.7 && trashed.length) {
      const row = pick(trashed)
      await d.records.purge([row.id])
      purgedTexts.add(row.content)
    } else {
      await syncDevice(d)
      continue
    }
    d.dirty = true
  }

  // Settle: a couple of rounds bring both devices and the remote to the same state.
  for (let round = 0; round < 3; round++) for (const d of devices) await syncDevice(d)

  const snapshot = async (r: Records) => (await r.all()).sort((a: LogRecord, b: LogRecord) => a.id - b.id)
  const [a, b] = await Promise.all(devices.map((d) => snapshot(d.records)))
  expect(a).toEqual(b)
  const liveEntries = a.filter((r) => r.deleted_at === null).map((r) => r.entry_id)
  expect(new Set(liveEntries).size).toBe(liveEntries.length)
  for (const r of a) if (r.purged_at !== null) expect(r).toMatchObject({ content: '', deleted_at: expect.any(Number) })
  // The remote file holds exactly the same rows.
  const remoteFile = [...server.files.values()][0].body
  expect((await fromSqliteFile(remoteFile)).sort((x, y) => x.id - y.id)).toEqual(a)
  // A purged text survives only where another row legitimately holds it (a restore copies the text).
  const remoteBytes = new TextDecoder('latin1').decode(remoteFile)
  let erased = 0
  for (const text of purgedTexts) {
    if (a.some((r) => r.content === text)) continue
    erased++
    expect(remoteBytes).not.toContain(text)
  }
  return { rows: a, erased, purged: purgedTexts.size }
}

const stats: { rows: number; tombstones: number; erased: number; restoredOrConcurrent: number }[] = []

describe('two-device convergence', () => {
  it.each(Array.from({ length: 25 }, (_, i) => i + 1))('random run %i converges', async (seed) => {
    const { rows, erased } = await run(seed)
    expect(rows.length).toBeGreaterThan(0)
    stats.push({ rows: rows.length, tombstones: rows.filter((r) => r.purged_at !== null).length, erased,
      restoredOrConcurrent: rows.filter((r) => r.deleted_at !== null && r.purged_at === null).length })
  })

  it('the runs exercise purges and conflicts', () => {
    expect(stats.reduce((n, s) => n + s.erased, 0)).toBeGreaterThan(20)
    expect(stats.reduce((n, s) => n + s.tombstones, 0)).toBeGreaterThan(50)
  })
})
