import { describe, expect, it } from 'vitest'
import { isDue } from './controller'

const MIN = 60_000

describe('isDue', () => {
  it('waits for the interval since the last sync or failed attempt', () => {
    expect(isDue(10 * MIN, 5, 0, 0)).toBe(true)
    expect(isDue(10 * MIN, 5, 6 * MIN, 0)).toBe(false)
    expect(isDue(11 * MIN, 5, 6 * MIN, 0)).toBe(true)
    // a failed attempt also restarts the wait, so errors don't retry every minute
    expect(isDue(11 * MIN, 5, 0, 9 * MIN)).toBe(false)
  })

  it('never fires in manual mode', () => {
    expect(isDue(Number.MAX_SAFE_INTEGER, 0)).toBe(false)
  })

  it('fires right away when this device has never synced', () => {
    expect(isDue(Date.now(), 24 * 60)).toBe(true)
  })
})
