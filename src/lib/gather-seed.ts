import type { MixKey } from './ticketing'

/**
 * A plausible sales history for the seed to write, standing in for what a
 * real Gather.rsvp orders read would give — see `salesHistory` in gather.ts.
 *
 * Not a model of real buying behaviour: a believable enough curve (a burst
 * around on-sale, a quieter middle, a smaller rush as the door nears) so the
 * sales-over-time chart has something worth drawing. The one thing that must
 * be exact is the grand total — it has to match `Event.sold`, the same
 * figure the revenue headline reads, or the chart and the headline would
 * disagree.
 */

const TIER_KEYS: readonly MixKey[] = ['sub', 'std', 'sup', 'door']

/**
 * Whole numbers from `weights`, proportioned to sum to exactly `total` — the
 * largest-remainder method (Hamilton apportionment), so rounding never loses
 * or invents a sale.
 */
export function allocateInteger(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return []
  if (total <= 0) return weights.map(() => 0)

  const sumW = weights.reduce((a, b) => a + b, 0)
  const raw =
    sumW > 0 ? weights.map((w) => (w / sumW) * total) : weights.map(() => total / weights.length)

  const floors = raw.map(Math.floor)
  const allocated = floors.reduce((a, b) => a + b, 0)
  let remaining = total - allocated

  const byRemainder = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)

  const result = [...floors]
  for (let k = 0; k < byRemainder.length && remaining > 0; k++, remaining--) {
    result[byRemainder[k].i] += 1
  }
  return result
}

/**
 * A front-and-back-loaded weight per day: a burst at on-sale, a rush near
 * the end, quieter in between.
 */
function dayWeights(days: number): number[] {
  if (days <= 1) return [1]
  return Array.from({ length: days }, (_, i) => {
    const early = Math.exp(-i / 3)
    const late = Math.exp(-(days - 1 - i) / 4)
    return 1 + 2 * early + 2.5 * late
  })
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

const DAY_MS = 24 * 60 * 60 * 1000

export interface PlausibleHistoryInput {
  /** The exact total every row must sum to — `Event.sold`. */
  sold: number
  /** [sub, std, sup, door] proportions, as `Event.mix` stores them. */
  mix: readonly number[]
  /** The first day of the history — when tickets went on sale. */
  since: Date
  /** The last day of the history. */
  today: Date
}

export interface PlausibleHistoryRow {
  day: Date
  tier: MixKey
  sold: number
}

export function plausibleSalesHistory(input: PlausibleHistoryInput): PlausibleHistoryRow[] {
  if (input.sold <= 0) return []

  const dayCount = Math.max(
    1,
    Math.round((input.today.getTime() - input.since.getTime()) / DAY_MS) + 1,
  )
  const perDay = allocateInteger(input.sold, dayWeights(dayCount))

  const mixTotal = input.mix.reduce((a, b) => a + b, 0)
  const mix = mixTotal > 0 ? input.mix : [0.25, 0.25, 0.25, 0.25]

  const rows: PlausibleHistoryRow[] = []
  for (let i = 0; i < dayCount; i++) {
    const dayTotal = perDay[i]
    if (dayTotal <= 0) continue

    const day = addDays(input.since, i)
    const perTier = allocateInteger(dayTotal, mix)
    TIER_KEYS.forEach((tier, t) => {
      if (perTier[t] > 0) rows.push({ day, tier, sold: perTier[t] })
    })
  }
  return rows
}
