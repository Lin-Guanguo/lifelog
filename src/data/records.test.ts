import initSqlJs, { type Database } from 'sql.js'
import { beforeEach, describe, expect, it } from 'vitest'
import { createRecords, DAY_MS, HOUR_MS, timeLeft, type Records } from './records'
import { migrate } from './schema'
import { sqlJsExecutor } from './sqljs'

let sqlDb: Database
let clock: number
let records: Records

const tick = (ms = 1000) => { clock += ms }

beforeEach(async () => {
  const SQL = await initSqlJs()
  sqlDb = new SQL.Database()
  clock = Date.UTC(2026, 10, 8, 10, 0)
  let n = 0
  const executor = sqlJsExecutor(sqlDb)
  await migrate(executor)
  records = createRecords(executor, () => clock, () => `id-${++n}`)
})

describe('records', () => {
  it('adds records in time order', async () => {
    await records.add('开始练胸')
    tick()
    await records.add('卧推，60 公斤，10 次')
    expect((await records.listLive()).map((r) => r.content)).toEqual(['开始练胸', '卧推，60 公斤，10 次'])
  })

  it('edit keeps the original time and moves the old text to the trash', async () => {
    await records.add('同样重量，8 词')
    const [original] = await records.listLive()
    tick(60_000)
    await records.edit(original, '同样重量，8 次')

    const live = await records.listLive()
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ entry_id: original.entry_id, logged_at: original.logged_at, content: '同样重量，8 次' })
    expect(live[0].written_at).toBe(clock)

    const { trashed, live: reference } = await records.listTrash()
    expect(trashed.map((r) => r.content)).toEqual(['同样重量，8 词'])
    expect(reference.map((r) => r.id)).toEqual([live[0].id])
  })

  it('editing a stale copy fails instead of creating two live rows', async () => {
    await records.add('a')
    const [stale] = await records.listLive()
    await records.edit(stale, 'b')
    await expect(records.edit(stale, 'c')).rejects.toThrow()
    expect((await records.listLive()).map((r) => r.content)).toEqual(['b'])
  })

  it('trashing removes entries from the live list', async () => {
    await records.add('a')
    await records.add('b')
    const [a] = await records.listLive()
    await records.trashEntries([a.entry_id])
    expect((await records.listLive()).map((r) => r.content)).toEqual(['b'])
    expect(await records.countTrash()).toBe(1)
  })

  it('restoring a deleted entry brings it back', async () => {
    await records.add('a')
    const [a] = await records.listLive()
    await records.trashEntries([a.entry_id])
    const { trashed } = await records.listTrash()
    await records.restore(trashed)
    expect((await records.listLive()).map((r) => r.content)).toEqual(['a'])
    expect(await records.countTrash()).toBe(0)
  })

  it('restoring pre-edit text overwrites the current text, which goes to the trash', async () => {
    await records.add('v1')
    tick()
    await records.edit((await records.listLive())[0], 'v2')
    const [v1] = (await records.listTrash()).trashed
    tick()
    await records.restore([v1])

    expect((await records.listLive()).map((r) => r.content)).toEqual(['v1'])
    expect((await records.listTrash()).trashed.map((r) => r.content)).toEqual(['v2'])
  })

  it('refuses to restore two rows of the same entry', async () => {
    await records.add('v1')
    await records.edit((await records.listLive())[0], 'v2')
    await records.edit((await records.listLive())[0], 'v3')
    const { trashed } = await records.listTrash()
    expect(trashed).toHaveLength(2)
    await expect(records.restore(trashed)).rejects.toThrow()
  })

  it('purges selected trash rows only', async () => {
    await records.add('a')
    await records.add('b')
    const [a, b] = await records.listLive()
    await records.trashEntries([a.entry_id, b.entry_id])
    await records.purge([a.id])
    expect((await records.listTrash()).trashed.map((r) => r.content)).toEqual(['b'])
    // live rows are never purged
    await records.add('c')
    const [c] = await records.listLive()
    await records.purge([c.id])
    expect(await records.listLive()).toHaveLength(1)
  })

  it('purgeExpired removes rows deleted longer ago than the retention', async () => {
    await records.add('old')
    await records.add('new')
    const [oldRow, newRow] = await records.listLive()
    await records.trashEntries([oldRow.entry_id])
    tick(5 * DAY_MS)
    await records.trashEntries([newRow.entry_id])
    tick(3 * DAY_MS)

    await records.purgeExpired(0)
    expect(await records.countTrash()).toBe(2)
    await records.purgeExpired(7 * 24)
    expect((await records.listTrash()).trashed.map((r) => r.content)).toEqual(['new'])
  })

  it('searches by substring and treats % and _ literally', async () => {
    await records.add('卧推，60 公斤')
    await records.add('上斜卧推 20 公斤')
    await records.add('完成 100%')
    await records.add('完成 1000')
    await records.add('a_b')
    await records.add('axb')
    expect((await records.searchLive('卧推')).map((r) => r.content).sort()).toEqual(['上斜卧推 20 公斤', '卧推，60 公斤'])
    expect((await records.searchLive('100%')).map((r) => r.content)).toEqual(['完成 100%'])
    expect((await records.searchLive('a_b')).map((r) => r.content)).toEqual(['a_b'])
  })

  it('trash search filters trashed rows and returns the matching entries\' live rows', async () => {
    await records.add('深蹲 80')
    await records.edit((await records.listLive())[0], '深蹲 80 公斤 5×5')
    await records.add('散步')
    const walk = (await records.listLive()).find((r) => r.content === '散步')!
    await records.trashEntries([walk.entry_id])

    const result = await records.listTrash('深蹲')
    expect(result.trashed.map((r) => r.content)).toEqual(['深蹲 80'])
    expect(result.live.map((r) => r.content)).toEqual(['深蹲 80 公斤 5×5'])
    expect((await records.listTrash('散')).live).toEqual([])
  })
})

describe('timeLeft', () => {
  it('counts down from the retention and is null when cleanup is off', () => {
    expect(timeLeft(0, 7 * 24, 0)).toBe(7 * DAY_MS)
    expect(timeLeft(0, 12, 3 * HOUR_MS)).toBe(9 * HOUR_MS)
    expect(timeLeft(0, 24, 2 * DAY_MS)).toBe(0)
    expect(timeLeft(0, 0, 0)).toBeNull()
  })
})
