import { describe, expect, it } from 'vitest'
import { around, extendDown, extendUp, follow, MAX, newest, STEP, WINDOW } from './timeline'

const entries = (n: number, from = 1) => Array.from({ length: n }, (_, i) => ({ entry_id: from + i }))

describe('timeline window', () => {
  it('starts on the newest entries, and draws everything when the log is short', () => {
    expect(newest(1000)).toEqual({ start: 1000 - WINDOW, end: 1000 })
    expect(newest(30)).toEqual({ start: 0, end: 30 })
  })

  it('centres a located entry, clamped at either end of the log', () => {
    expect(around(500, 1000)).toEqual({ start: 500 - (WINDOW / 2 - 1), end: 500 + WINDOW / 2 + 1 })
    expect(around(10, 1000)).toEqual({ start: 0, end: WINDOW })
    expect(around(995, 1000)).toEqual({ start: 1000 - WINDOW, end: 1000 })
  })

  it('extends at the edge being scrolled to and drops the far edge past the maximum', () => {
    let range = newest(1000)
    range = extendUp(range)
    expect(range).toEqual({ start: 1000 - WINDOW - STEP, end: 1000 })
    range = extendUp(extendUp(range))
    expect(range.end - range.start).toBe(MAX)
    expect(range.start).toBe(1000 - WINDOW - 3 * STEP)
    range = extendDown(range, 1000)
    expect(range.end).toBe(1000) // already at the newest
    expect(extendUp({ start: 0, end: 100 })).toEqual({ start: 0, end: 100 })
  })

  it('follows changes to the list: new entries join a window at the newest, others keep their place', () => {
    const before = entries(300)
    expect(follow(newest(300), before, entries(301))).toEqual({ start: 300 - WINDOW, end: 301 })
    // a whole log arriving at once (a fresh install's first sync): the usual window at the newest
    expect(follow(newest(0), [], entries(800))).toEqual(newest(800))
    // an older window, with an entry inserted before it by sync: the same entries stay drawn
    const range = { start: 100, end: 250 }
    const after = [{ entry_id: 0 }, ...before]
    expect(follow(range, before, after)).toEqual({ start: 101, end: 251 })
    // its first entry deleted: stays where it was
    expect(follow(range, before, before.filter((r) => r.entry_id !== 101))).toEqual({ start: 100, end: 250 })
  })
})
