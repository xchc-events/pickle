import { describe, expect, it } from 'vitest'
import { readSales } from './gather'

/**
 * `readSales` is the one place Ticketing reads how many have sold. Today it
 * is a stub over the event's own row rather than a real call to Gather.rsvp
 * (docs/gather-rsvp-api.md, section 3.1 "Event summary"), but everything that
 * wants a sold count goes through it, so the day a real client exists it is
 * the only thing that changes.
 */
describe('readSales', () => {
  it("reads the sold count and the read time off the event's row", () => {
    const updatedAt = new Date('2026-09-22T16:10:00+12:00')
    expect(readSales({ sold: 78, updatedAt })).toEqual({ sold: 78, readAt: updatedAt })
  })

  it('is shaped like the API brief’s event summary — a sold count and when it was true', () => {
    const result = readSales({ sold: 0, updatedAt: new Date('2026-01-01T00:00:00+13:00') })
    expect(Object.keys(result).sort()).toEqual(['readAt', 'sold'])
  })

  it('carries zero sold rather than treating it as missing', () => {
    const updatedAt = new Date('2026-09-01T09:00:00+12:00')
    expect(readSales({ sold: 0, updatedAt }).sold).toBe(0)
  })
})
