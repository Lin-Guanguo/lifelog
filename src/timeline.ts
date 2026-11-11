// The main list draws a window of the log, not all of it: a range of indexes into the entries (oldest first).
// Scrolling near an edge extends it there and, past MAX, drops entries at the far edge, so a long log stays light.

export const WINDOW = 200 // entries drawn at first, around a located entry, and after jumping to the latest
export const STEP = 100 // added at an edge when scrolling near it
export const MAX = 500 // at most this many drawn
// Scroll distances, in screens of the list (its height on a typical phone, e.g. 675 px on a Pixel 7).
export const SCREEN_PX = 700
export const EDGE_PX = SCREEN_PX * 3 // closer than this to an edge of the drawn list, it extends there (ahead of a fling)
export const JUMP_PX = SCREEN_PX * 2 // the jump-to-latest button shows with more than this below the screen

export interface Range {
  start: number // first index drawn
  end: number // one past the last
}

export function newest(total: number): Range {
  return { start: Math.max(0, total - WINDOW), end: total }
}

// The located entry with WINDOW / 2 - 1 before it and WINDOW / 2 after (99 and 100), shifted to fit the log.
export function around(index: number, total: number): Range {
  const end = Math.min(total, Math.max(0, index - (WINDOW / 2 - 1)) + WINDOW)
  return { start: Math.max(0, end - WINDOW), end }
}

export function extendUp(range: Range): Range {
  const start = Math.max(0, range.start - STEP)
  return { start, end: Math.min(range.end, start + MAX) }
}

export function extendDown(range: Range, total: number): Range {
  const end = Math.min(total, range.end + STEP)
  return { start: Math.max(range.start, end - MAX), end }
}

// After the list changed (an entry added, edited, deleted, or merged by sync): the same entries stay drawn,
// found by the id of the first one; a window that reached the newest entry keeps reaching it.
export function follow(range: Range, before: { entry_id: number }[], after: { entry_id: number }[]): Range {
  if (before.length === 0) return newest(after.length) // the first entries arrived (e.g. a fresh install's first sync)
  if (range.end >= before.length) {
    const size = Math.min(MAX, range.end - range.start + Math.max(0, after.length - before.length))
    return { start: Math.max(0, after.length - size), end: after.length }
  }
  const first = before[range.start]?.entry_id
  const found = after.findIndex((r) => r.entry_id === first)
  const start = found >= 0 ? found : Math.min(range.start, Math.max(0, after.length - 1))
  return { start, end: Math.min(after.length, start + (range.end - range.start)) }
}
