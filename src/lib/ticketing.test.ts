import { describe, expect, it } from 'vitest'
import {
  MIX_LABELS,
  capacityOf,
  mixProblem,
  normaliseMix,
  paceOf,
  sellThrough,
  tierTable,
} from './ticketing'
import { avgTicket, tiers } from './finance'

/**
 * Ticketing.
 *
 * The money here belongs to `finance.ts` — `tiers`, `avgTicket`, `breakeven`
 * and `fullPay` all live there and are not reimplemented. What this file adds
 * is the room's capacity, the four-way mix, and the pace read.
 *
 * Tested first because `std` is the single number every ticket price derives
 * from, and the mix decides the average that reaches the P&L. Getting either
 * wrong misprices a whole show.
 */

describe('capacityOf', () => {
  /**
   * Capacity is a fact about a room, so it is read off the room's row.
   *
   * It used to come from constants, with the function matching the literal
   * string 'Apartment U1' — so adding a room needed a code change and
   * `Space.capacity` was read by nothing. These fixtures are deliberately not
   * the venue's real figures: a test that passes only for 220 and 150 would
   * still pass against hard-coded constants.
   */
  const main = { capacity: 220, seatedCapacity: 150 }
  const other = { capacity: 90, seatedCapacity: 64 }

  it("uses the room's standing capacity for a standing format", () => {
    expect(capacityOf(main, 'DJs')).toBe(220)
    expect(capacityOf(main, 'Live music')).toBe(220)
  })

  it("uses the room's seated capacity when it is laid out cabaret", () => {
    expect(capacityOf(main, 'Cabaret')).toBe(150)
  })

  it('reads both figures off the row, not off constants', () => {
    expect(capacityOf(other, 'DJs')).toBe(90)
    expect(capacityOf(other, 'Cabaret')).toBe(64)
  })
})

describe('the tier table', () => {
  /** Every price derives from `std`. That is the point of the model. */
  it('derives every tier from the standard price', () => {
    const rows = tierTable(30, 40, [0.15, 0.5, 0.2, 0.15])
    expect(rows.map((r) => r.price)).toEqual([24, 30, 36, 40])
  })

  it('agrees with finance.ts rather than working it out again', () => {
    const t = tiers({ std: 30, door: 40 })
    const rows = tierTable(30, 40, [0.15, 0.5, 0.2, 0.15])
    expect(rows.find((r) => r.key === 'sub')!.price).toBe(t.sub)
    expect(rows.find((r) => r.key === 'sup')!.price).toBe(t.sup)
  })

  it('carries the share of the mix each tier takes', () => {
    const rows = tierTable(30, 40, [0.15, 0.5, 0.2, 0.15])
    expect(rows.map((r) => r.share)).toEqual([0.15, 0.5, 0.2, 0.15])
  })

  /**
   * The handoff README's prose said "supporter/standard/subsidised" and was
   * wrong; the prototype's `TIER_KEYS` and `avgTicket` both say subsidised
   * first. A supporter pays more than standard, so a table that labels the
   * cheap tier "Supporter" is telling the coordinator something false. This
   * test is what stops it inverting again.
   */
  it('labels the cheap tier subsidised and the dear one supporter', () => {
    const rows = tierTable(30, 40, [0.15, 0.5, 0.2, 0.15])
    expect(rows.map((r) => r.label)).toEqual([...MIX_LABELS])

    const sub = rows.find((r) => r.label === 'Subsidised')!
    const sup = rows.find((r) => r.label === 'Supporter')!
    const std = rows.find((r) => r.label === 'Standard')!
    expect(sub.price).toBeLessThan(std.price)
    expect(sup.price).toBeGreaterThan(std.price)
  })

  it('rounds to whole dollars — the venue does not sell a $23.50 ticket', () => {
    expect(tierTable(29, 35, [0.25, 0.25, 0.25, 0.25]).map((r) => r.price)).toEqual([
      23, 29, 35, 35,
    ])
  })
})

describe('the mix', () => {
  it('is happy when the four proportions make a whole', () => {
    expect(mixProblem([0.15, 0.5, 0.2, 0.15])).toBeNull()
  })

  it('complains when they do not', () => {
    expect(mixProblem([0.5, 0.5, 0.5, 0.5])).toMatch(/100|whole|sum/i)
  })

  it('tolerates the rounding a person typing percentages produces', () => {
    expect(mixProblem([0.333, 0.333, 0.334, 0])).toBeNull()
  })

  it('rejects a negative share', () => {
    expect(mixProblem([-0.1, 0.6, 0.3, 0.2])).toMatch(/negative|below zero/i)
  })

  it('rejects a mix that is not four numbers', () => {
    expect(mixProblem([0.5, 0.5])).toMatch(/four/i)
  })

  it('normalises a near-miss so the average is computed off a whole', () => {
    const n = normaliseMix([0.3, 0.3, 0.3, 0.3])
    expect(n.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
  })

  it('leaves an already-whole mix alone', () => {
    expect(normaliseMix([0.15, 0.5, 0.2, 0.15])).toEqual([0.15, 0.5, 0.2, 0.15])
  })

  it('falls back to an even split rather than dividing by zero', () => {
    expect(normaliseMix([0, 0, 0, 0])).toEqual([0.25, 0.25, 0.25, 0.25])
  })

  it('produces the average finance.ts would', () => {
    const mix: [number, number, number, number] = [0.15, 0.5, 0.2, 0.15]
    const rows = tierTable(30, 40, mix)
    const fromRows = rows.reduce((n, r) => n + r.price * r.share, 0)
    expect(fromRows).toBeCloseTo(avgTicket({ std: 30, door: 40, mix }), 6)
  })
})

describe('sellThrough', () => {
  it('is a percentage of the room', () => {
    expect(sellThrough(110, 220)).toBe(50)
  })

  it('is zero for an empty room rather than NaN', () => {
    expect(sellThrough(0, 0)).toBe(0)
  })

  it('does not report over 100 — a sold-out room is sold out', () => {
    expect(sellThrough(300, 220)).toBe(100)
  })
})

describe('paceOf', () => {
  /**
   * The projection is the prototype's own: a flat assumption that sales to
   * date are 56% of the eventual total. It is a placeholder for real curve
   * data from Gather.rsvp, and it is labelled as one — see the note in
   * ticketing.ts. What matters is that it is stated rather than implied.
   */
  it('projects a final from what has sold', () => {
    expect(paceOf({ sold: 56, breakeven: 80 }).projected).toBe(100)
  })

  it('projects nothing before anything has sold', () => {
    const p = paceOf({ sold: 0, breakeven: 80 })
    expect(p.projected).toBe(0)
    expect(p.tone).toBe('plain')
    expect(p.note).toMatch(/nothing|no sales|not on sale/i)
  })

  it('reads well when the projection clears breakeven', () => {
    const p = paceOf({ sold: 56, breakeven: 80 })
    expect(p.tone).toBe('good')
    expect(p.note).toMatch(/clear|ahead|above/i)
  })

  it('warns when the projection lands short of breakeven', () => {
    const p = paceOf({ sold: 20, breakeven: 120 })
    expect(p.tone).toBe('stop')
    expect(p.note).toMatch(/short|below|under/i)
  })

  it('says how many more are needed to break even', () => {
    expect(paceOf({ sold: 20, breakeven: 120 }).toBreakeven).toBe(100)
  })

  it('says none are needed once breakeven is passed', () => {
    expect(paceOf({ sold: 130, breakeven: 120 }).toBreakeven).toBe(0)
  })
})
