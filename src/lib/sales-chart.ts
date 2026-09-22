import { MIX_LABELS, type MixKey } from './ticketing'
import { dateLabel } from './format'

/**
 * The sales-over-time chart.
 *
 * Pure geometry only — no SVG, no React. `buildChart` turns the sales
 * history, the finance markers and the chosen time scale into plain numbers;
 * a client component draws `<polyline>` / `<circle>` / `<line>` / `<text>`
 * from them. Money and the breakeven/full-pay markers are never worked out
 * here — `finance.ts`, via `ticketing-data.ts`, is where those come from;
 * this file only places them on an axis.
 */

export const TIER_KEYS: readonly MixKey[] = ['sub', 'std', 'sup', 'door']

/** One lookup, built off `MIX_LABELS` rather than retyping the four names. */
export const TIER_LABEL: Record<MixKey, string> = {
  sub: MIX_LABELS[0],
  std: MIX_LABELS[1],
  sup: MIX_LABELS[2],
  door: MIX_LABELS[3],
}

export type TimeScale = 'since-on-sale' | 'last-14' | 'last-7'

export const TIME_SCALES: { key: TimeScale; label: string }[] = [
  { key: 'since-on-sale', label: 'Since on sale' },
  { key: 'last-14', label: 'Last 14 days' },
  { key: 'last-7', label: 'Last 7 days' },
]

/** One tier's ticket sales on one day. Not a running total. */
export interface SaleDay {
  day: Date
  tier: MixKey
  sold: number
}

export interface CumulativePoint {
  day: Date
  cumulative: number
}

/**
 * Each tier's true running total, from its very first sale — independent of
 * whatever window the chart is currently showing. `windowSeries` below is
 * what clips this to what is actually on screen.
 */
export function cumulativeByTier(history: readonly SaleDay[]): Record<MixKey, CumulativePoint[]> {
  const result = {} as Record<MixKey, CumulativePoint[]>

  for (const tier of TIER_KEYS) {
    const rows = history
      .filter((r) => r.tier === tier)
      .slice()
      .sort((a, b) => a.day.getTime() - b.day.getTime())

    let running = 0
    result[tier] = rows.map((row) => {
      running += row.sold
      return { day: row.day, cumulative: running }
    })
  }

  return result
}

/** The earliest day in the history, across every tier, or null when there is none. */
export function earliestSaleDay(history: readonly SaleDay[]): Date | null {
  if (history.length === 0) return null
  return history.reduce((min, r) => (r.day.getTime() < min.getTime() ? r.day : min), history[0].day)
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The x-axis's start for a given time-scale choice.
 *
 * "Last 7/14 days" never reaches earlier than the day tickets actually went
 * on sale — a show three days on sale has no earlier window to zoom to, so
 * it falls back to the same start "since on sale" would use.
 */
export function sinceFor(scale: TimeScale, onSaleAt: Date, today: Date): Date {
  if (scale === 'since-on-sale') return onSaleAt

  const days = scale === 'last-7' ? 7 : 14
  const cutoff = new Date(today.getTime() - days * DAY_MS)
  return cutoff.getTime() > onSaleAt.getTime() ? cutoff : onSaleAt
}

/**
 * A tier's cumulative series, clipped to `[since, asOf]`.
 *
 * The value carried into the window is a point at `since` — the running
 * total as of then, not zero — so zooming to a recent window does not make
 * it look like sales restarted. The line is then carried flat to `asOf` when
 * the last actual sale was earlier, so every tier's line reaches the same
 * right edge, whether or not it sold anything today.
 */
export function windowSeries(
  series: readonly CumulativePoint[],
  since: Date,
  asOf: Date,
): CumulativePoint[] {
  const before = series.filter((p) => p.day.getTime() < since.getTime())
  const within = series.filter(
    (p) => p.day.getTime() >= since.getTime() && p.day.getTime() <= asOf.getTime(),
  )

  const runningAtStart = before.length > 0 ? before[before.length - 1].cumulative : 0
  const points: CumulativePoint[] =
    within.length > 0 && within[0].day.getTime() === since.getTime()
      ? within
      : [{ day: since, cumulative: runningAtStart }, ...within]

  const last = points[points.length - 1]
  if (last.day.getTime() < asOf.getTime()) {
    points.push({ day: asOf, cumulative: last.cumulative })
  }

  return points
}

export interface Domain {
  min: number
  max: number
}

/**
 * Maps a value in `[domain.min, domain.max]` onto `[0, size]`.
 *
 * A degenerate domain (`min === max` — one day of history, or a window with
 * nothing before today) maps everything to 0 rather than dividing by zero:
 * the caller still gets a point to draw, not a NaN.
 */
export function scaleLinear(value: number, domain: Domain, size: number): number {
  const span = domain.max - domain.min
  if (span <= 0) return 0
  return ((value - domain.min) / span) * size
}

export interface ProjectionSegment {
  from: CumulativePoint
  to: CumulativePoint
}

/**
 * The dashed continuation from today's actual total to where `paceOf`
 * expects the show to land by the door.
 *
 * Reuses the pace's own `projected` figure rather than reworking it —
 * `paceOf` in ticketing.ts is still the only place that projects a final
 * count; this only places it on the chart. Null once the door has passed, or
 * when the pace projects no further growth: nothing drawn is more honest
 * than a flat or falling dashed line.
 */
export function projectionSegment(
  today: Date,
  todayTotal: number,
  doorAt: Date,
  projectedTotal: number,
): ProjectionSegment | null {
  if (doorAt.getTime() <= today.getTime()) return null
  if (projectedTotal <= todayTotal) return null

  return {
    from: { day: today, cumulative: todayTotal },
    to: { day: doorAt, cumulative: projectedTotal },
  }
}

// ------------------------------------------------------------- geometry ---

export interface ChartMargin {
  top: number
  right: number
  bottom: number
  left: number
}

export interface ChartInput {
  history: readonly SaleDay[]
  /** The Gather channel push's time, else the first sale. */
  onSaleAt: Date
  today: Date
  /** The event's own night — "the door" everywhere else in this app. */
  doorAt: Date
  breakeven: number
  fullPay: number
  /** `paceOf(...).projected` — never reworked here. */
  projectedTotal: number
  timeScale: TimeScale
  width: number
  height: number
  margin: ChartMargin
}

export interface PlottedPoint {
  x: number
  y: number
  day: Date
  cumulative: number
}

export interface TierLine {
  tier: MixKey
  label: string
  points: PlottedPoint[]
  /** This tier's cumulative total as of today — what the legend shows. */
  total: number
}

export interface AxisTick {
  x: number
  label: string
}

export interface ChartGeometry {
  width: number
  height: number
  plot: { x: number; y: number; width: number; height: number }
  /** Always all four tiers — toggling the legend is the component's own
   *  render decision, not a reason to recompute the geometry. */
  lines: TierLine[]
  projection: { x1: number; y1: number; x2: number; y2: number } | null
  breakevenY: number
  fullPayY: number
  todayX: number
  xTicks: AxisTick[]
  maxCount: number
}

/**
 * Everything a client component needs to draw the chart, computed once from
 * plain data.
 */
export function buildChart(input: ChartInput): ChartGeometry {
  const { width, height, margin } = input
  const plot = {
    x: margin.left,
    y: margin.top,
    width: Math.max(0, width - margin.left - margin.right),
    height: Math.max(0, height - margin.top - margin.bottom),
  }

  const since = sinceFor(input.timeScale, input.onSaleAt, input.today)
  // The projection can run past `today` to the door, so the x domain always
  // reaches at least as far as the door — "since on sale" vs "last 7 days"
  // only changes how much history sits to its left.
  const domainEnd = input.doorAt.getTime() > input.today.getTime() ? input.doorAt : input.today

  const byTier = cumulativeByTier(input.history)

  const totalAsOf = (asOf: Date) =>
    TIER_KEYS.reduce((sum, tier) => {
      const upTo = byTier[tier].filter((p) => p.day.getTime() <= asOf.getTime())
      return sum + (upTo.length > 0 ? upTo[upTo.length - 1].cumulative : 0)
    }, 0)

  const totalToday = totalAsOf(input.today)
  const projection = projectionSegment(input.today, totalToday, input.doorAt, input.projectedTotal)

  const maxCount = Math.max(
    input.fullPay,
    input.breakeven,
    projection?.to.cumulative ?? 0,
    ...TIER_KEYS.map((tier) => {
      const series = byTier[tier]
      return series.length > 0 ? series[series.length - 1].cumulative : 0
    }),
    1,
  )

  const x = (day: Date) =>
    plot.x +
    scaleLinear(day.getTime(), { min: since.getTime(), max: domainEnd.getTime() }, plot.width)
  const y = (count: number) => plot.y + plot.height - scaleLinear(count, { min: 0, max: maxCount }, plot.height)

  const lines: TierLine[] = TIER_KEYS.map((tier) => {
    const windowed = windowSeries(byTier[tier], since, input.today)
    const points = windowed.map((p) => ({
      x: x(p.day),
      y: y(p.cumulative),
      day: p.day,
      cumulative: p.cumulative,
    }))
    const total = windowed.length > 0 ? windowed[windowed.length - 1].cumulative : 0
    return { tier, label: TIER_LABEL[tier], points, total }
  })

  const xTicks: AxisTick[] = [{ x: x(since), label: dateLabel(since) }, { x: x(input.today), label: 'Today' }]
  if (input.doorAt.getTime() > input.today.getTime()) {
    xTicks.push({ x: x(input.doorAt), label: dateLabel(input.doorAt) })
  }

  return {
    width,
    height,
    plot,
    lines,
    projection: projection
      ? {
          x1: x(projection.from.day),
          y1: y(projection.from.cumulative),
          x2: x(projection.to.day),
          y2: y(projection.to.cumulative),
        }
      : null,
    breakevenY: y(input.breakeven),
    fullPayY: y(input.fullPay),
    todayX: x(input.today),
    xTicks,
    maxCount,
  }
}
