import initSqlJs from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { createRecords, type Records } from './data/records'
import { migrate } from './data/schema'
import { sqlJsExecutor } from './data/sqljs'
import { around, extendDown, extendUp, MAX, newest, refresh, STEP, WINDOW, type Window } from './timeline'

const HOUR = 3_600_000
let records: Records
let clock: number

// A log of n entries "1" … "n", an hour apart.
async function log(n: number) {
  for (let i = 1; i <= n; i++) {
    clock += HOUR
    await records.add(String(i))
  }
}
const names = (w: Window) => w.rows.map((r) => Number(r.content))
const span = (w: Window) => [names(w)[0], names(w).at(-1), w.rows.length, w.older, w.newer]
const entryOf = async (n: number) => (await records.listLive()).find((r) => r.content === String(n))!.entry_id

beforeEach(async () => {
  const SQL = await initSqlJs()
  const executor = sqlJsExecutor(new SQL.Database())
  await migrate(executor)
  clock = Date.UTC(2026, 0, 1)
  records = createRecords(executor, () => clock, () => 0)
})

describe('timeline window', () => {
  it('reads the newest entries, or all of a short log', async () => {
    await log(1000)
    expect(span(await newest(records))).toEqual([1000 - WINDOW + 1, 1000, WINDOW, true, false])
    expect(span(await newest(createShort()))).toEqual([undefined, undefined, 0, false, false])
  })

  it('reads a located entry with 99 before and 100 after, more on one side near either end', async () => {
    await log(1000)
    expect(span((await around(records, await entryOf(500)))!)).toEqual([401, 600, WINDOW, true, true])
    expect(span((await around(records, await entryOf(10)))!)).toEqual([1, WINDOW, WINDOW, false, true])
    expect(span((await around(records, await entryOf(995)))!)).toEqual([1000 - WINDOW + 1, 1000, WINDOW, true, false])
    expect(await around(records, 12345)).toBeUndefined()
  })

  it('extends at the edge being scrolled to and drops the far edge past the maximum', async () => {
    await log(1000)
    let w = await newest(records)
    w = await extendUp(records, w)
    expect(span(w)).toEqual([1000 - WINDOW - STEP + 1, 1000, WINDOW + STEP, true, false])
    w = await extendUp(records, await extendUp(records, w))
    expect(span(w)).toEqual([1000 - MAX + 1, 1000, MAX, true, false]) // full, nothing dropped yet
    w = await extendUp(records, w)
    expect(span(w)).toEqual([1000 - MAX - STEP + 1, 1000 - STEP, MAX, true, true]) // the newest dropped
    w = await extendDown(records, w)
    expect(span(w)).toEqual([1000 - MAX + 1, 1000, MAX, true, false])
    let top = await newest(createShort())
    expect(await extendUp(records, top)).toBe(top)
    top = (await around(records, await entryOf(1)))!
    expect(await extendUp(records, top)).toBe(top)
  })

  it('pages are exact when entries share a time', async () => {
    for (let i = 1; i <= 30; i++) await records.add(String(i), Date.UTC(2026, 0, 1)) // all at the same moment
    const all = await records.listLive()
    const first = await records.before(all[15], 10)
    const next = await records.after(all[15], 10)
    expect([...first.rows, all[15], ...next.rows].map((r) => Number(r.content))).toEqual(Array.from({ length: 21 }, (_, i) => i + 6))
  })

  it('follows changes: new entries join a window at the newest, others keep their place', async () => {
    await log(300)
    let w = await newest(records)
    clock += HOUR
    await records.add('301')
    w = await refresh(records, w)
    expect(span(w)).toEqual([300 - WINDOW + 1, 301, WINDOW + 1, true, false])

    // an older window, with an earlier entry merged in before it: the same entries stay
    const mid = (await around(records, await entryOf(150)))!
    await records.add('0', Date.UTC(2025, 0, 1))
    expect(span(await refresh(records, mid))).toEqual(span(mid))
    // its first entry deleted: the window starts at the next one
    await records.trashEntries([mid.rows[0].entry_id])
    expect(names(await refresh(records, mid))[0]).toBe(names(mid)[1])
    // its first entry edited: still first
    const w2 = await refresh(records, mid)
    await records.edit(w2.rows[0], 'edited')
    expect((await refresh(records, w2)).rows[0].content).toBe('edited')
  })

  it('a window that reached the oldest entry takes in entries that arrive before it', async () => {
    await log(5)
    const w = await newest(records)
    await records.add('0', Date.UTC(2025, 0, 1)) // e.g. merged by sync, or restored
    expect(span(await refresh(records, w))).toEqual([0, 5, 6, false, false])
  })

  it('a window at the newest that would pass the maximum becomes the newest MAX', async () => {
    await log(1000)
    let w = await newest(records)
    for (let i = 0; i < 4; i++) w = await extendUp(records, w)
    expect([w.rows.length, w.newer]).toEqual([MAX, true]) // dropped the newest: not at the newest any more
    w = await newest(records, MAX)
    clock += HOUR
    await records.add('1001')
    expect(span(await refresh(records, w))).toEqual([1001 - MAX + 1, 1001, MAX, true, false])
  })
})

function createShort(): Records {
  return { ...records, newest: async () => ({ rows: [], more: false }) }
}
