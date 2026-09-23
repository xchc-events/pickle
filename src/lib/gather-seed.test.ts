import { describe, expect, it } from 'vitest'
import { allocateInteger, plausibleSalesHistory } from './gather-seed'

/**
 * The seed's sales history.
 *
 * The one hard requirement — stated in the brief this ported — is that the
 * fabricated history's grand total always matches `Event.sold` exactly, so
 * the sales-over-time chart and the revenue headline (both ultimately reads
 * of the same figure) can never disagree. Everything else about the curve is
 * cosmetic.
 */

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`)

describe('allocateInteger', () => {
  it('sums to the total exactly, whatever the weights', () => {
    expect(allocateInteger(10, [1, 1, 1])).toEqual([4, 3, 3])
    expect(allocateInteger(100, [0.2, 0.4, 0.15, 0.25]).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('spreads evenly when every weight is zero, rather than losing the total', () => {
    const result = allocateInteger(9, [0, 0, 0])
    expect(result.reduce((a, b) => a + b, 0)).toBe(9)
  })

  it('gives nothing away when the total is zero', () => {
    expect(allocateInteger(0, [1, 2, 3])).toEqual([0, 0, 0])
  })

  it('never invents a share for an empty weight list', () => {
    expect(allocateInteger(10, [])).toEqual([])
  })

  it('gives every unit to the single weight there is', () => {
    expect(allocateInteger(7, [1])).toEqual([7])
  })
})

describe('plausibleSalesHistory', () => {
  it('sums to exactly the requested total, over a normal on-sale window', () => {
    const rows = plausibleSalesHistory({
      sold: 84,
      mix: [0.2, 0.4, 0.15, 0.25],
      since: day('2026-09-01'),
      today: day('2026-09-16'),
    })
    expect(rows.reduce((n, r) => n + r.sold, 0)).toBe(84)
  })

  it('sums to the total for every sold count from 1 to 40, not just round numbers', () => {
    for (let sold = 1; sold <= 40; sold++) {
      const rows = plausibleSalesHistory({
        sold,
        mix: [0.15, 0.5, 0.2, 0.15],
        since: day('2026-09-01'),
        today: day('2026-09-20'),
      })
      expect(rows.reduce((n, r) => n + r.sold, 0)).toBe(sold)
    }
  })

  it('puts everything on the one day when on-sale and today are the same day', () => {
    const rows = plausibleSalesHistory({
      sold: 12,
      mix: [0.2, 0.4, 0.15, 0.25],
      since: day('2026-09-10'),
      today: day('2026-09-10'),
    })
    expect(rows.every((r) => r.day.getTime() === day('2026-09-10').getTime())).toBe(true)
    expect(rows.reduce((n, r) => n + r.sold, 0)).toBe(12)
  })

  it('is empty when nothing has sold', () => {
    expect(
      plausibleSalesHistory({
        sold: 0,
        mix: [0.2, 0.4, 0.15, 0.25],
        since: day('2026-09-01'),
        today: day('2026-09-10'),
      }),
    ).toEqual([])
  })

  it('never writes a row for a tier with nothing on it that day', () => {
    const rows = plausibleSalesHistory({
      sold: 5,
      mix: [0.2, 0.4, 0.15, 0.25],
      since: day('2026-09-01'),
      today: day('2026-09-01'),
    })
    expect(rows.every((r) => r.sold > 0)).toBe(true)
  })

  it('falls back to an even split when the mix is all zero, rather than dropping sales', () => {
    const rows = plausibleSalesHistory({
      sold: 20,
      mix: [0, 0, 0, 0],
      since: day('2026-09-01'),
      today: day('2026-09-05'),
    })
    expect(rows.reduce((n, r) => n + r.sold, 0)).toBe(20)
  })

  it('never dates a row outside the [since, today] window', () => {
    const since = day('2026-09-01')
    const today = day('2026-09-10')
    const rows = plausibleSalesHistory({ sold: 60, mix: [0.2, 0.4, 0.15, 0.25], since, today })
    for (const r of rows) {
      expect(r.day.getTime()).toBeGreaterThanOrEqual(since.getTime())
      expect(r.day.getTime()).toBeLessThanOrEqual(today.getTime())
    }
  })
})
