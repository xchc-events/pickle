import { describe, expect, it } from 'vitest'
import {
  buildChart,
  cumulativeByTier,
  earliestSaleDay,
  projectionSegment,
  scaleLinear,
  sinceFor,
  windowSeries,
  type ChartInput,
  type SaleDay,
} from './sales-chart'

/**
 * The sales-over-time chart.
 *
 * Money is not worked out here — `breakeven`, `fullPay` and the projected
 * total all arrive from finance.ts via `paceOf`, already computed. What this
 * file tests is the geometry: turning daily-and-per-tier sales into
 * cumulative lines, placing them on an axis, and the dashed segment that
 * continues a line to the door.
 */

const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`)

describe('scaleLinear', () => {
  it('maps the domain minimum to zero', () => {
    expect(scaleLinear(0, { min: 0, max: 100 }, 200)).toBe(0)
  })

  it('maps the domain maximum to the full size', () => {
    expect(scaleLinear(100, { min: 0, max: 100 }, 200)).toBe(200)
  })

  it('maps the midpoint to half the size', () => {
    expect(scaleLinear(50, { min: 0, max: 100 }, 200)).toBe(100)
  })

  it('does not divide by zero on a degenerate domain', () => {
    expect(scaleLinear(5, { min: 5, max: 5 }, 200)).toBe(0)
    expect(scaleLinear(5, { min: 8, max: 5 }, 200)).toBe(0)
  })
})

describe('cumulativeByTier', () => {
  it('runs a total per tier, in day order, regardless of input order', () => {
    const history: SaleDay[] = [
      { day: day('2026-09-03'), tier: 'std', sold: 4 },
      { day: day('2026-09-01'), tier: 'std', sold: 10 },
      { day: day('2026-09-02'), tier: 'std', sold: 6 },
    ]

    const byTier = cumulativeByTier(history)
    expect(byTier.std.map((p) => p.cumulative)).toEqual([10, 16, 20])
    expect(byTier.std.map((p) => p.day.getTime())).toEqual([
      day('2026-09-01').getTime(),
      day('2026-09-02').getTime(),
      day('2026-09-03').getTime(),
    ])
  })

  it('keeps every tier separate', () => {
    const history: SaleDay[] = [
      { day: day('2026-09-01'), tier: 'sub', sold: 2 },
      { day: day('2026-09-01'), tier: 'std', sold: 5 },
    ]

    const byTier = cumulativeByTier(history)
    expect(byTier.sub.map((p) => p.cumulative)).toEqual([2])
    expect(byTier.std.map((p) => p.cumulative)).toEqual([5])
  })

  it('gives a tier that never sold an empty series rather than a missing key', () => {
    const byTier = cumulativeByTier([])
    expect(byTier.sub).toEqual([])
    expect(byTier.std).toEqual([])
    expect(byTier.sup).toEqual([])
    expect(byTier.door).toEqual([])
  })
})

describe('earliestSaleDay', () => {
  it('finds the earliest day across every tier', () => {
    const history: SaleDay[] = [
      { day: day('2026-09-05'), tier: 'std', sold: 4 },
      { day: day('2026-09-02'), tier: 'sup', sold: 1 },
    ]
    expect(earliestSaleDay(history)?.getTime()).toBe(day('2026-09-02').getTime())
  })

  it('is null when there is no history', () => {
    expect(earliestSaleDay([])).toBeNull()
  })
})

describe('sinceFor', () => {
  const onSaleAt = day('2026-09-01')
  const today = day('2026-09-20')

  it('starts from the on-sale day by default', () => {
    expect(sinceFor('since-on-sale', onSaleAt, today).getTime()).toBe(onSaleAt.getTime())
  })

  it('starts 7 or 14 days before today when those are picked', () => {
    expect(sinceFor('last-7', onSaleAt, today).getTime()).toBe(today.getTime() - 7 * 86400000)
    expect(sinceFor('last-14', onSaleAt, today).getTime()).toBe(today.getTime() - 14 * 86400000)
  })

  it('never reaches earlier than on-sale, for a show that has not been on sale that long', () => {
    const justWentOnSale = day('2026-09-18')
    expect(sinceFor('last-14', justWentOnSale, today).getTime()).toBe(justWentOnSale.getTime())
  })
})

describe('windowSeries', () => {
  const series = [
    { day: day('2026-09-01'), cumulative: 5 },
    { day: day('2026-09-05'), cumulative: 12 },
    { day: day('2026-09-10'), cumulative: 20 },
  ]

  it('carries the running total into the window rather than restarting at zero', () => {
    const windowed = windowSeries(series, day('2026-09-08'), day('2026-09-10'))
    expect(windowed[0]).toEqual({ day: day('2026-09-08'), cumulative: 12 })
  })

  it('starts at zero when the window begins before any sale', () => {
    const windowed = windowSeries(series, day('2026-08-25'), day('2026-09-01'))
    expect(windowed[0]).toEqual({ day: day('2026-08-25'), cumulative: 0 })
  })

  it('carries the last value flat to the end of the window', () => {
    const windowed = windowSeries(series, day('2026-09-01'), day('2026-09-20'))
    const last = windowed[windowed.length - 1]
    expect(last).toEqual({ day: day('2026-09-20'), cumulative: 20 })
  })

  it('does not duplicate a point that already sits exactly on the window start', () => {
    const windowed = windowSeries(series, day('2026-09-01'), day('2026-09-10'))
    expect(windowed.filter((p) => p.day.getTime() === day('2026-09-01').getTime())).toHaveLength(1)
  })
})

describe('projectionSegment', () => {
  it('runs from today to the door', () => {
    const seg = projectionSegment(day('2026-09-20'), 100, day('2026-10-01'), 180)
    expect(seg).toEqual({
      from: { day: day('2026-09-20'), cumulative: 100 },
      to: { day: day('2026-10-01'), cumulative: 180 },
    })
  })

  it('is null once the door has passed', () => {
    expect(projectionSegment(day('2026-09-20'), 100, day('2026-09-10'), 180)).toBeNull()
  })

  it('is null when the pace projects no further growth', () => {
    expect(projectionSegment(day('2026-09-20'), 150, day('2026-10-01'), 150)).toBeNull()
    expect(projectionSegment(day('2026-09-20'), 150, day('2026-10-01'), 120)).toBeNull()
  })
})

describe('buildChart', () => {
  const baseInput: ChartInput = {
    history: [
      { day: day('2026-09-01'), tier: 'std', sold: 20 },
      { day: day('2026-09-05'), tier: 'std', sold: 15 },
      { day: day('2026-09-05'), tier: 'sub', sold: 5 },
      { day: day('2026-09-10'), tier: 'std', sold: 10 },
    ],
    onSaleAt: day('2026-09-01'),
    today: day('2026-09-10'),
    doorAt: day('2026-10-01'),
    breakeven: 80,
    fullPay: 150,
    projectedTotal: 120,
    timeScale: 'since-on-sale',
    width: 760,
    height: 320,
    margin: { top: 20, right: 20, bottom: 30, left: 40 },
  }

  it('produces one line per tier, always, whatever sold', () => {
    const chart = buildChart(baseInput)
    expect(chart.lines.map((l) => l.tier)).toEqual(['sub', 'std', 'sup', 'door'])
    expect(chart.lines.find((l) => l.tier === 'std')!.total).toBe(45)
    expect(chart.lines.find((l) => l.tier === 'sup')!.total).toBe(0)
  })

  it('keeps every coordinate inside the plotted area, never NaN', () => {
    const chart = buildChart(baseInput)
    for (const line of chart.lines) {
      for (const p of line.points) {
        expect(Number.isFinite(p.x)).toBe(true)
        expect(Number.isFinite(p.y)).toBe(true)
        expect(p.x).toBeGreaterThanOrEqual(chart.plot.x)
        expect(p.x).toBeLessThanOrEqual(chart.plot.x + chart.plot.width)
      }
    }
  })

  it('draws a projection from today to the door when the pace expects more sales', () => {
    const chart = buildChart(baseInput)
    expect(chart.projection).not.toBeNull()
    expect(chart.projection!.x1).toBeCloseTo(chart.todayX, 5)
    // The projection's far end sits further right than today, towards the door.
    expect(chart.projection!.x2).toBeGreaterThan(chart.projection!.x1)
  })

  it('places breakeven and full-pay higher up the chart the larger they are', () => {
    const chart = buildChart(baseInput)
    // SVG y grows downward, so the larger figure sits at the smaller y.
    expect(chart.fullPayY).toBeLessThan(chart.breakevenY)
  })

  it('still produces finite geometry with a single day of history', () => {
    const oneDay: ChartInput = {
      ...baseInput,
      history: [{ day: day('2026-09-10'), tier: 'std', sold: 3 }],
      onSaleAt: day('2026-09-10'),
      today: day('2026-09-10'),
    }
    const chart = buildChart(oneDay)
    for (const line of chart.lines) {
      for (const p of line.points) {
        expect(Number.isFinite(p.x)).toBe(true)
        expect(Number.isFinite(p.y)).toBe(true)
      }
    }
  })

  it('produces flat-zero lines with no projection when nothing has sold yet', () => {
    const nothing: ChartInput = {
      ...baseInput,
      history: [],
      projectedTotal: 0,
    }
    const chart = buildChart(nothing)
    expect(chart.lines.every((l) => l.total === 0)).toBe(true)
    expect(chart.projection).toBeNull()
  })
})
