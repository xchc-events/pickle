import { CFG, tiers } from './finance'

/**
 * Ticketing.
 *
 * The money is not here. `tiers`, `avgTicket`, `breakeven` and `fullPay` all
 * live in `finance.ts`, which is specification, and this module reads them
 * rather than working them out again — two places that both compute an
 * average ticket price is two places that can disagree about what a show is
 * worth.
 *
 * What this file adds is the room's capacity, the four-way mix, and the pace
 * read. Pure over plain shapes, so all of it is testable without a database.
 */

/**
 * The order the four proportions are stored in on `Event.mix`.
 *
 * **Subsidised first, supporter third.** Worth stating plainly because the
 * handoff README's prose says the opposite ("supporter/standard/subsidised"),
 * and the schema comment copied that prose. The code is authoritative: the
 * prototype's own `TIER_KEYS` is [sub, std, sup, door], and `avgTicket` in
 * finance.ts pairs `mix[0]` with `tiers().sub`.
 *
 * Getting it backwards is not a cosmetic slip. A supporter pays *more* than
 * standard and a subsidised ticket costs *less*, so inverting the labels tells
 * a coordinator that supporters pay the cheap price — and prices the show off
 * that belief.
 */
export const MIX_LABELS = ['Subsidised', 'Standard', 'Supporter', 'Door sale'] as const

export type MixKey = 'sub' | 'std' | 'sup' | 'door'

/**
 * How many people the room holds.
 *
 * Lives here rather than in `roster.ts`, which needs the same rule to decide
 * whether a second bar staff goes on. One capacity rule, read from two
 * places — the alternative is two copies that drift the first time the venue
 * changes a layout.
 */
export function capacityOf(spaceName: string, format: string): number {
  if (spaceName === 'Apartment U1') return CFG.capApt
  return format === 'Cabaret' ? CFG.capSeated : CFG.capMusic
}

export interface TierRow {
  key: MixKey
  label: string
  price: number
  /** This tier's share of the mix, 0–1. */
  share: number
}

/**
 * The four prices and what proportion of the room buys each.
 *
 * The mapping is written out rather than zipped so the pairing is readable:
 * `mix[0]` is the subsidised share and takes the subsidised price, and so on
 * down. This matches `avgTicket` in finance.ts exactly, and the test that
 * compares the two is what keeps it that way.
 */
export function tierTable(
  std: number,
  door: number,
  mix: readonly number[],
): [TierRow, TierRow, TierRow, TierRow] {
  const t = tiers({ std, door })

  return [
    { key: 'sub', label: MIX_LABELS[0], price: t.sub, share: mix[0] ?? 0 },
    { key: 'std', label: MIX_LABELS[1], price: t.std, share: mix[1] ?? 0 },
    { key: 'sup', label: MIX_LABELS[2], price: t.sup, share: mix[2] ?? 0 },
    { key: 'door', label: MIX_LABELS[3], price: t.door, share: mix[3] ?? 0 },
  ]
}

/** How far off a whole a mix may be before it is wrong rather than rounded. */
const MIX_TOLERANCE = 0.005

/** What is wrong with a mix, in words, or nothing. */
export function mixProblem(mix: readonly number[]): string | null {
  if (mix.length !== 4) {
    return 'A mix is four proportions — subsidised, standard, supporter, door.'
  }

  if (mix.some((n) => !Number.isFinite(n) || n < 0)) {
    return 'A share cannot be negative.'
  }

  const total = mix.reduce((a, b) => a + b, 0)
  if (Math.abs(total - 1) > MIX_TOLERANCE) {
    return `The four shares have to make a whole. These come to ${Math.round(total * 100)}%.`
  }

  return null
}

/**
 * A mix that sums to exactly one.
 *
 * A person typing thirds gets 0.33 three times and the average comes out
 * fractionally low. Scaling to a whole is the honest fix; an even split is
 * the fallback when there is nothing to scale, because dividing by zero here
 * would produce a NaN that reaches the P&L.
 */
export function normaliseMix(mix: readonly number[]): [number, number, number, number] {
  const four = [mix[0] ?? 0, mix[1] ?? 0, mix[2] ?? 0, mix[3] ?? 0]
  const total = four.reduce((a, b) => a + b, 0)

  if (total <= 0) return [0.25, 0.25, 0.25, 0.25]
  if (Math.abs(total - 1) < 1e-9) return four as [number, number, number, number]

  return four.map((n) => n / total) as [number, number, number, number]
}

/** Percentage of the room sold, never over 100. */
export function sellThrough(sold: number, capacity: number): number {
  if (capacity <= 0) return 0
  return Math.min(100, Math.round((sold / capacity) * 100))
}

/**
 * The share of eventual sales that has typically happened by now.
 *
 * This is the prototype's own flat assumption and it is a placeholder, not a
 * model: it takes no account of how long the event has been on sale or how
 * close the door is. It is kept because a stated crude number a coordinator
 * can argue with beats an unstated one, and it is labelled in the interface
 * as a rough read. Replace it with a real curve once Gather.rsvp is
 * connected and there is sales history to fit against.
 */
const SOLD_BY_NOW = 0.56

export type PaceTone = 'good' | 'warn' | 'stop' | 'plain'

export interface Pace {
  /** Where sales look like landing. Zero before anything has sold. */
  projected: number
  /** How many more are needed to cover the event's costs. */
  toBreakeven: number
  tone: PaceTone
  note: string
}

export function paceOf(input: { sold: number; breakeven: number }): Pace {
  const toBreakeven = Math.max(0, input.breakeven - input.sold)

  if (input.sold <= 0) {
    return {
      projected: 0,
      toBreakeven,
      tone: 'plain',
      note: 'Nothing sold yet, so there is no pace to read.',
    }
  }

  const projected = Math.round(input.sold / SOLD_BY_NOW)

  if (projected >= input.breakeven) {
    return {
      projected,
      toBreakeven,
      tone: 'good',
      note: `On this pace the show clears breakeven with ${projected - input.breakeven} to spare.`,
    }
  }

  return {
    projected,
    toBreakeven,
    tone: 'stop',
    note: `On this pace the show lands ${input.breakeven - projected} short of breakeven.`,
  }
}
