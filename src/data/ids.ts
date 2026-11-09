// Row ids: integers that any device can create offline without colliding, ordered by creation time,
// and exact in JavaScript (below 2^53): (milliseconds since 2026-01-01) × 4096 + 12 random bits.
// They last until about 2095. An entry's entry_id is the id of its first row.
export const ID_EPOCH = Date.UTC(2026, 0, 1)
const LOW = 4096

export function makeId(time: number, low12: number): number {
  return Math.max(0, time - ID_EPOCH) * LOW + (low12 & (LOW - 1))
}

// 12 bits of a 32-bit FNV-1a hash: the deterministic "random" part when converting old text ids.
export function hash12(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0) & (LOW - 1)
}
