import type { Cursor, LogRecord, Records } from './data/records'

// The main list holds a window of the log, read from the database in pages, never the whole log: a contiguous run of
// live entries in time order (oldest first). Scrolling near an edge reads the next page there and, past MAX, drops
// entries at the far edge, so a long log stays light in memory and on screen.

export const WINDOW = 200 // entries read at first, around a located entry, and after jumping to the latest
export const STEP = 100 // read at an edge when scrolling near it
export const MAX = 500 // at most this many held

// Scroll distances, in screens of the list (its height on a typical phone, e.g. 675 px on a Pixel 7).
export const SCREEN_PX = 700
export const EDGE_PX = SCREEN_PX * 3 // closer than this to an edge of the window, the next page is read (ahead of a fling)
export const JUMP_PX = SCREEN_PX * 2 // the jump-to-latest button shows with more than this below the screen

export interface Window {
  rows: LogRecord[]
  older: boolean // entries exist before the first row
  newer: boolean // entries exist after the last row
}

export const EMPTY: Window = { rows: [], older: false, newer: false }

type Pages = Pick<Records, 'newest' | 'before' | 'from' | 'after' | 'getLive'>

export async function newest(pages: Pages, limit = WINDOW): Promise<Window> {
  const page = await pages.newest(limit)
  return { rows: page.rows, older: page.more, newer: false }
}

// The entry with WINDOW / 2 - 1 before it and WINDOW / 2 after (99 and 100), more on one side where the other runs out.
export async function around(pages: Pages, entryId: number): Promise<Window | undefined> {
  const target = await pages.getLive(entryId)
  if (!target) return undefined
  const [before, after] = await Promise.all([pages.before(target, WINDOW), pages.after(target, WINDOW)])
  const nAfter = Math.min(after.rows.length, Math.max(WINDOW / 2, WINDOW - 1 - before.rows.length))
  const nBefore = Math.min(before.rows.length, WINDOW - 1 - nAfter)
  return {
    rows: [...before.rows.slice(before.rows.length - nBefore), target, ...after.rows.slice(0, nAfter)],
    older: before.more || nBefore < before.rows.length,
    newer: after.more || nAfter < after.rows.length,
  }
}

export async function extendUp(pages: Pages, w: Window): Promise<Window> {
  if (!w.older || w.rows.length === 0) return w
  const page = await pages.before(w.rows[0], STEP)
  const rows = [...page.rows, ...w.rows]
  return { rows: rows.slice(0, MAX), older: page.more, newer: w.newer || rows.length > MAX }
}

export async function extendDown(pages: Pages, w: Window): Promise<Window> {
  if (!w.newer || w.rows.length === 0) return w
  const page = await pages.after(w.rows[w.rows.length - 1], STEP)
  const rows = [...w.rows, ...page.rows]
  return { rows: rows.slice(Math.max(0, rows.length - MAX)), older: w.older || rows.length > MAX, newer: page.more }
}

const START: Cursor = { logged_at: Number.MIN_SAFE_INTEGER, id: Number.MIN_SAFE_INTEGER } // before any entry

// After the log changed (an entry added, edited, deleted, restored, or merged by sync): read the window again from
// its first entry, so what is on screen stays. One that reached an end of the log keeps reaching it (entries that
// arrived before the oldest or after the newest join it), up to MAX.
export async function refresh(pages: Pages, w: Window): Promise<Window> {
  if (w.rows.length === 0) return newest(pages)
  const first = w.older ? w.rows[0] : START
  const [page, before] = await Promise.all([
    pages.from(first, w.newer ? w.rows.length : MAX),
    pages.before(first, 0),
  ])
  if (page.rows.length === 0) return newest(pages)
  if (!w.newer && page.more) return newest(pages, MAX) // more new entries than fit: the newest MAX
  return { rows: page.rows, older: before.more, newer: page.more }
}
