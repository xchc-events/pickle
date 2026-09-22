'use client'

import { useMemo, useState } from 'react'
import { TIME_SCALES, buildChart, type ChartGeometry, type TimeScale } from '@/lib/sales-chart'
import { SOLD_BY_NOW, type MixKey } from '@/lib/ticketing'
import styles from './SalesChart.module.css'

export interface SalesChartProps {
  history: { day: Date; tier: MixKey; sold: number }[]
  onSaleAt: Date
  today: Date
  doorAt: Date
  breakeven: number
  fullPay: number
  projectedTotal: number
  sold: number
}

// The viewBox the chart is drawn in. At least twice the height of the 26px
// bar it replaces — a lot more than that, once axes, a legend and points are
// on it. Margins leave room for the outer axis labels so they never sit on
// top of a mark.
const WIDTH = 760
const HEIGHT = 340
// Left and right both need room for a centred axis-tick label whose point
// sits right on the plot's edge, not just for the breakeven/full-pay text.
const MARGIN = { top: 18, right: 28, bottom: 30, left: 28 }

const TIER_CLASS: Record<MixKey, string> = {
  sub: styles.tierSub,
  std: styles.tierStd,
  sup: styles.tierSup,
  door: styles.tierDoor,
}

/**
 * Ticket sales over time, by tier.
 *
 * All the maths — the cumulative totals, the scale, the projection segment —
 * comes from `buildChart` in src/lib/sales-chart.ts, already computed. This
 * component only holds two pieces of UI state (which tiers are toggled off,
 * which time scale is picked) and draws what it is given.
 */
export function SalesChart(props: SalesChartProps) {
  const [timeScale, setTimeScale] = useState<TimeScale>('since-on-sale')
  const [hidden, setHidden] = useState<ReadonlySet<MixKey>>(() => new Set())

  const chart: ChartGeometry = useMemo(
    () =>
      buildChart({
        history: props.history,
        onSaleAt: props.onSaleAt,
        today: props.today,
        doorAt: props.doorAt,
        breakeven: props.breakeven,
        fullPay: props.fullPay,
        projectedTotal: props.projectedTotal,
        timeScale,
        width: WIDTH,
        height: HEIGHT,
        margin: MARGIN,
      }),
    [
      props.history,
      props.onSaleAt,
      props.today,
      props.doorAt,
      props.breakeven,
      props.fullPay,
      props.projectedTotal,
      timeScale,
    ],
  )

  if (props.history.length === 0) {
    return <p className={styles.empty}>No sales yet.</p>
  }

  const toggleTier = (tier: MixKey) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(tier)) next.delete(tier)
      else next.add(tier)
      return next
    })
  }

  const right = chart.plot.x + chart.plot.width

  return (
    <div className={styles.wrap}>
      <div className={styles.scales} role="group" aria-label="Time scale">
        {TIME_SCALES.map((opt) => (
          <button
            key={opt.key}
            type="button"
            className={`${styles.scaleBtn} ${timeScale === opt.key ? styles.scaleOn : ''}`}
            aria-pressed={timeScale === opt.key}
            onClick={() => setTimeScale(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        className={styles.svg}
        role="img"
        aria-label={`Ticket sales over time, by tier: ${props.sold} sold, ${props.breakeven} to break even, ${props.fullPay} to pay everyone in full`}
      >
        <line
          x1={chart.plot.x}
          x2={right}
          y1={chart.fullPayY}
          y2={chart.fullPayY}
          className={styles.fullPayLine}
        />
        <text x={right} y={chart.fullPayY - 6} className={styles.refLabel} textAnchor="end">
          Full pay {props.fullPay}
        </text>

        <line
          x1={chart.plot.x}
          x2={right}
          y1={chart.breakevenY}
          y2={chart.breakevenY}
          className={styles.breakevenLine}
        />
        <text x={right} y={chart.breakevenY + 14} className={styles.refLabel} textAnchor="end">
          Breakeven {props.breakeven}
        </text>

        <line
          x1={chart.todayX}
          x2={chart.todayX}
          y1={chart.plot.y}
          y2={chart.plot.y + chart.plot.height}
          className={styles.todayLine}
        />

        {chart.projection ? (
          <line
            x1={chart.projection.x1}
            y1={chart.projection.y1}
            x2={chart.projection.x2}
            y2={chart.projection.y2}
            className={styles.projectionLine}
          />
        ) : null}

        {chart.lines.map((line) =>
          hidden.has(line.tier) ? null : (
            <g key={line.tier} className={TIER_CLASS[line.tier]}>
              <polyline
                points={line.points.map((p) => `${p.x},${p.y}`).join(' ')}
                className={styles.line}
              />
              {line.points.map((p) => (
                <circle key={p.day.getTime()} cx={p.x} cy={p.y} r={2.5} className={styles.point} />
              ))}
            </g>
          ),
        )}

        {chart.xTicks.map((t) => (
          <text
            key={t.label + t.x}
            x={t.x}
            y={chart.plot.y + chart.plot.height + 18}
            className={styles.axisLabel}
            textAnchor="middle"
          >
            {t.label}
          </text>
        ))}
      </svg>

      <div className={styles.legend}>
        {chart.lines.map((line) => (
          <button
            key={line.tier}
            type="button"
            className={`${styles.legendItem} ${hidden.has(line.tier) ? styles.legendOff : ''}`}
            aria-pressed={!hidden.has(line.tier)}
            onClick={() => toggleTier(line.tier)}
          >
            <span className={`${styles.swatch} ${TIER_CLASS[line.tier]}`} />
            {line.label} · {line.total}
          </button>
        ))}
      </div>

      <div className={styles.figures}>
        <span>
          <b>{props.sold}</b> sold
        </span>
        <span>
          <b>{props.breakeven}</b> to break even
        </span>
        <span>
          <b>{props.fullPay}</b> to pay everyone in full
        </span>
      </div>

      {/* The projection is drawn, not just implied — say what it assumes,
          in the same number paceOf actually used, so it reads as a rough
          read rather than a forecast. */}
      <p className={styles.caveat}>
        Projection assumes sales so far are {Math.round(SOLD_BY_NOW * 100)}% of the eventual total —
        a rough read, not a model, until Gather.rsvp is connected.
      </p>
    </div>
  )
}
