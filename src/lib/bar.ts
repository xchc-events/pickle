import { CFG, type FinanceVals } from './finance'
import { timeMinutes } from './event-record'
import { money } from './format'
import type { BarClose } from './actuals'

/**
 * The bar, as three questions.
 *
 *  1. **What do we think will happen?** A budget for each night, locked when
 *     the event goes on sale, so the answer is what was believed then rather
 *     than a projection that quietly drifts towards whatever happened.
 *  2. **How did we actually perform, and why?** The bar half of the night's
 *     reconciliation against that budget, with the gap split into reasons
 *     that add up to it exactly.
 *  3. **So what?** Nights rolled up by month, overs and unders carried as a
 *     running total, and the nights still to come re-priced at recent rates —
 *     so a hole shows before the month it lands in.
 *
 * Nothing here is a second model of the bar. The budget is the settlement's
 * own bar line (`financeVals().barMarg`) with bar labour beside it, at the flat
 * stock cost the model uses; the actual is what the till took. Epos Now is the
 * till, the stock system and the thing that tells Xero about bar sales — this
 * product never orders stock and never posts a bar sale. Decided 16 September
 * 2026.
 *
 * Pure over plain shapes, so all of it is testable without a database.
 */

export type Tone = 'good' | 'warn' | 'stop' | 'plain'

// ------------------------------------------------------------------ roles ---

/**
 * The roster roles that are the bar. An exact list rather than the
 * prototype's "starts with Bar or Duty", which would sweep in any role a venue
 * later names that way.
 */
export const BAR_ROLES = ['Duty manager', 'Bar staff'] as const

export const isBarRole = (role: string): boolean => (BAR_ROLES as readonly string[]).includes(role)

// ---------------------------------------------------------------- window ---

/** A run time from minutes past midnight, carried past 1440 for the small hours. */
function timeLabel(minutes: number): string {
  const inDay = ((minutes % 1440) + 1440) % 1440
  const h24 = Math.floor(inDay / 60)
  const m = inDay % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(m).padStart(2, '0')}${h24 < 12 ? 'am' : 'pm'}`
}

export interface ServiceWindow {
  /** Half an hour before doors. Null until doors are set on the event record. */
  opens: string | null
  closes: string | null
  /** Hours of service. Null until both ends are known. */
  hours: number | null
}

/**
 * When the bar is open on the night.
 *
 * It comes off the event record — doors and bar close — and is never set here.
 * Nothing is assumed for a time nobody has set: a window invented for an event
 * with no doors would put the wrong sales against it.
 */
export function serviceWindow(doors: string | null, barClose: string | null): ServiceWindow {
  const doorsAt = doors ? timeMinutes(doors) : 0
  const closesAt = barClose ? timeMinutes(barClose) : 0

  const opensAt = doorsAt > 0 ? doorsAt - 30 : null
  const hours =
    opensAt !== null && closesAt > 0
      ? Math.round(Math.max(1, (closesAt - opensAt) / 60) * 10) / 10
      : null

  return {
    opens: opensAt !== null ? timeLabel(opensAt) : null,
    closes: closesAt > 0 ? (barClose as string) : null,
    hours,
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A calendar day plus minutes past its midnight, as wall-clock `YYYY-MM-DDTHH:mm:ss`. */
function wallClock(year: number, month: number, day: number, minutes: number): string {
  // Calendar arithmetic in UTC so no daylight-saving change in the server's
  // own zone can shift the hour. These strings are a time on the venue's
  // clock, not an instant.
  const d = new Date(Date.UTC(year, month, day, 0, minutes))
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`
  )
}

/**
 * The night's service window as the till's own clock reads it.
 *
 * Epos Now filters sales by wall-clock time in the account's zone, so these
 * are local strings with no offset. The calendar day is read the way every
 * screen in the product reads an event's date (see `dateLabel`), and a bar
 * closing after midnight rolls into the next day — into the next month when
 * it has to.
 */
export function tillWindow(
  eventDate: Date,
  doors: string | null,
  barClose: string | null,
): { start: string; end: string } | null {
  if (!doors || !barClose) return null
  const doorsAt = timeMinutes(doors)
  const closesAt = timeMinutes(barClose)
  if (doorsAt <= 0 || closesAt <= 0) return null

  const y = eventDate.getFullYear()
  const m = eventDate.getMonth()
  const d = eventDate.getDate()
  return { start: wallClock(y, m, d, doorsAt - 30), end: wallClock(y, m, d, closesAt) }
}

/**
 * Whether the night has come, so its bar can be closed.
 *
 * From the event's own calendar day onwards — the till is often closed after
 * midnight, which is the day after. Before it, there is nothing to close, and
 * a figure entered then is a guess dressed as a count.
 */
export function nightHasCome(eventDate: Date, now: Date): boolean {
  const night = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return today >= night
}

// ---------------------------------------------------------------- budget ---

/** What is frozen when an event goes on sale. */
export interface BarBudgetFigures {
  /** People expected through the door — the scenario the settlement reads. */
  heads: number
  /** Spend per head, GST inclusive — the event's `barHead`. */
  spendPerHead: number
  /** Bar margin after stock, GST exclusive: the settlement's bar line at lock. */
  margin: number
  /** The stock cost the margin was worked at, so a later change cannot rewrite it. */
  stockCostPct: number
  /** Planned bar hours — duty manager and bar staff. */
  labourHours: number
  /** The loaded rate those hours were costed at. */
  loadedRate: number
}

/**
 * The budget, taken from the settlement's own projection.
 *
 * Heads and margin come straight off `financeVals`, never recomputed, so the
 * budget and the settlement's bar line are the same number at the moment it is
 * locked. A fixed-and-variable build replaces the flat stock cost later, once
 * there are actuals to build it from — as a recorded finance.ts decision.
 */
export function barBudgetFrom(input: {
  vals: Pick<FinanceVals, 'att' | 'barMarg'>
  barHead: number
  labourHours: number
}): BarBudgetFigures {
  return {
    heads: input.vals.att,
    spendPerHead: input.barHead,
    margin: input.vals.barMarg,
    stockCostPct: CFG.stockCost,
    labourHours: input.labourHours,
    loadedRate: CFG.loaded,
  }
}

/** One night at the bar, budgeted or actual, in the same terms either way. */
export interface BarNight {
  /** Null when nobody has counted the door yet. */
  heads: number | null
  /** GST inclusive. */
  take: number
  takeEx: number
  stockCost: number
  /** After stock, GST exclusive. */
  margin: number
  /** Margin over the GST-exclusive take. Zero for a bar that took nothing. */
  marginPct: number
  /** GST inclusive. Null until the door is counted. */
  spendPerHead: number | null
  labourHours: number
  labour: number
  /** What the bar keeps after stock and its own labour. */
  contribution: number
}

const pctOf = (margin: number, takeEx: number) => (takeEx > 0 ? margin / takeEx : 0)

export function nightFromBudget(b: BarBudgetFigures): BarNight {
  const take = b.heads * b.spendPerHead
  const takeEx = take / CFG.gst
  const labour = b.labourHours * b.loadedRate
  return {
    heads: b.heads,
    take,
    takeEx,
    stockCost: takeEx - b.margin,
    margin: b.margin,
    marginPct: pctOf(b.margin, takeEx),
    spendPerHead: b.spendPerHead,
    labourHours: b.labourHours,
    labour,
    contribution: b.margin - labour,
  }
}

/**
 * The night as it happened: the bar half of the reconciliation, the door count
 * if it is in, and the bar hours on the roster.
 */
export function nightFromActual(input: {
  bar: BarClose
  heads: number | null
  labourHours: number
}): BarNight {
  const take = input.bar.barTake
  const takeEx = take / CFG.gst
  const margin = input.bar.barProfit
  const labour = input.labourHours * CFG.loaded
  return {
    heads: input.heads,
    take,
    takeEx,
    stockCost: takeEx - margin,
    margin,
    marginPct: pctOf(margin, takeEx),
    spendPerHead: input.heads && input.heads > 0 ? take / input.heads : null,
    labourHours: input.labourHours,
    labour,
    contribution: margin - labour,
  }
}

// -------------------------------------------------------------- variance ---

/**
 * The reasons a night came in over or under, each in what the bar keeps.
 *
 *  - `turnout`: more or fewer people than budgeted, at the budgeted spend.
 *  - `spend`:   each of them spending more or less than budgeted.
 *  - `take`:    the two together, when the door is not counted and they cannot
 *               be told apart.
 *  - `rate`:    the margin after stock running richer or thinner than budgeted.
 *  - `labour`:  more or fewer bar hours than planned.
 */
export interface Effects {
  turnout: number
  spend: number
  take: number
  rate: number
  labour: number
}

export type DriverKey = keyof Effects

export interface VarianceResult {
  /** Actual take less budgeted take, GST inclusive. */
  takeVariance: number
  /** Actual contribution less budgeted contribution. */
  contributionVariance: number
  /** Adds up to `contributionVariance` exactly. */
  effects: Effects
  /** The reason that moved the night most, or null when nothing moved. */
  driver: DriverKey | null
}

const NOTHING_MOVED = 1 // a dollar

export function driverOf(effects: Effects): DriverKey | null {
  let best: DriverKey | null = null
  for (const key of Object.keys(effects) as DriverKey[]) {
    if (Math.abs(effects[key]) < NOTHING_MOVED) continue
    if (best === null || Math.abs(effects[key]) > Math.abs(effects[best])) best = key
  }
  return best
}

/**
 * Why a night differed from its budget.
 *
 * Every effect is stated in contribution — what the bar keeps after stock and
 * labour — and together they are the whole gap, with nothing left over. The
 * split is the standard one: volume at the budgeted rate, then the rate on the
 * actual volume, which is what makes it exact rather than approximate.
 */
export function varianceOf(budget: BarNight, actual: BarNight): VarianceResult {
  const budgetRate = budget.marginPct
  const effects: Effects = { turnout: 0, spend: 0, take: 0, rate: 0, labour: 0 }

  const canSplit =
    budget.heads !== null &&
    actual.heads !== null &&
    budget.spendPerHead !== null &&
    actual.spendPerHead !== null

  if (canSplit) {
    const turnoutTake = (actual.heads! - budget.heads!) * budget.spendPerHead!
    const spendTake = (actual.spendPerHead! - budget.spendPerHead!) * actual.heads!
    effects.turnout = (turnoutTake / CFG.gst) * budgetRate
    effects.spend = (spendTake / CFG.gst) * budgetRate
  } else {
    effects.take = ((actual.take - budget.take) / CFG.gst) * budgetRate
  }

  effects.rate = (actual.marginPct - budgetRate) * actual.takeEx
  effects.labour = -(actual.labour - budget.labour)

  return {
    takeVariance: actual.take - budget.take,
    contributionVariance: actual.contribution - budget.contribution,
    effects,
    driver: driverOf(effects),
  }
}

export const DRIVER_LABEL: Record<DriverKey, string> = {
  turnout: 'Turnout',
  spend: 'Spend per head',
  take: 'Takings',
  rate: 'Margin after stock',
  labour: 'Bar labour',
}

/** "Spend per head moved it most — $212 under." Null when nothing moved. */
export function driverLine(v: Pick<VarianceResult, 'effects' | 'driver'>): string | null {
  if (!v.driver) return null
  const effect = v.effects[v.driver]
  return `${DRIVER_LABEL[v.driver]} moved it most — ${money(Math.abs(effect))} ${effect < 0 ? 'under' : 'over'}.`
}

// --------------------------------------------------------- what sold, why ---

/** One product's sales on the night, as read off the till. */
export interface SoldLine {
  /** Epos Now's product id. Null for an open-price sale with no product behind it. */
  eposProductId?: number | null
  name: string
  category: string | null
  units: number
  /** GST inclusive, after item discounts. */
  revenue: number
  revenueEx: number
  /** GST exclusive. Zero when Epos Now held no cost price for it. */
  cost: number
  costKnown: boolean
}

export interface DragRow extends SoldLine {
  /** This line's own margin after stock. Null when its cost is unknown. */
  gp: number | null
  /** What this line did to the margin, against the margin the budget assumed. */
  effect: number
}

/**
 * The margin effect, spread over what sold.
 *
 * A line selling below the margin the budget assumed drags the night down by
 * its GST-exclusive revenue times the shortfall; a richer line lifts it. The
 * lines plus what cannot be put on any one product — basket discounts, service
 * charge, rounding — are the whole of the margin effect.
 *
 * A line with no cost price in Epos Now is flagged rather than read as pure
 * profit. It still counts in the arithmetic, so the rows keep adding up, but a
 * reader is told the margin it shows is overstated.
 */
export function marginDrag(
  lines: SoldLine[],
  budgetMarginPct: number,
  actual: { takeEx: number; margin: number },
): { rows: DragRow[]; residual: number; missingCost: number } {
  const rows = lines
    .map((l): DragRow => {
      const lineMargin = l.revenueEx - l.cost
      return {
        ...l,
        gp: l.costKnown && l.revenueEx > 0 ? lineMargin / l.revenueEx : null,
        effect: lineMargin - l.revenueEx * budgetMarginPct,
      }
    })
    .sort((a, b) => a.effect - b.effect)

  const rateEffect = actual.margin - actual.takeEx * budgetMarginPct
  const residual = rateEffect - rows.reduce((a, r) => a + r.effect, 0)

  return { rows, residual, missingCost: lines.filter((l) => !l.costKnown).length }
}

// ---------------------------------------------------------------- months ---

/** A night, in the three states the months view compares. */
export interface BarEventSummary {
  id: string
  name: string
  date: Date
  /** Locked when the event went on sale. Null before then, or for a night that never was. */
  budget: BarNight | null
  /** The latest projection, off the settlement's current figures. */
  projection: BarNight
  /** Null until the bar is closed. */
  actual: BarNight | null
}

export interface MonthRow {
  /** `2026-09`. */
  key: string
  /** `Sep 2026`. */
  label: string
  events: number
  budgeted: number
  closed: number
  budgetTake: number
  budgetContribution: number
  /** What happened where it has, the projection where it has not. */
  forecastTake: number
  forecastContribution: number
  actualTake: number
  actualContribution: number
  /** Like for like: nights with both a budget and an actual. Null when there are none. */
  variance: number | null
  /** Contribution from closed nights that were never budgeted. */
  unbudgeted: number
  /** Overs and unders carried through every month to this one. */
  running: number
  effects: Effects
  driver: DriverKey | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

export function monthRows(events: BarEventSummary[]): MonthRow[] {
  const byMonth = new Map<string, BarEventSummary[]>()
  for (const e of [...events].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const k = monthKey(e.date)
    byMonth.set(k, [...(byMonth.get(k) ?? []), e])
  }

  let running = 0
  return [...byMonth.entries()].map(([key, nights]) => {
    const effects: Effects = { turnout: 0, spend: 0, take: 0, rate: 0, labour: 0 }
    let variance: number | null = null
    let unbudgeted = 0

    for (const n of nights) {
      if (n.actual && n.budget) {
        const v = varianceOf(n.budget, n.actual)
        variance = (variance ?? 0) + v.contributionVariance
        for (const k of Object.keys(effects) as DriverKey[]) effects[k] += v.effects[k]
      } else if (n.actual) {
        unbudgeted += n.actual.contribution
      }
    }

    running += variance ?? 0
    const sum = (pick: (e: BarEventSummary) => number) => nights.reduce((a, n) => a + pick(n), 0)
    const first = nights[0]!.date

    return {
      key,
      label: `${MONTHS[first.getMonth()]} ${first.getFullYear()}`,
      events: nights.length,
      budgeted: nights.filter((n) => n.budget).length,
      closed: nights.filter((n) => n.actual).length,
      budgetTake: sum((n) => n.budget?.take ?? 0),
      budgetContribution: sum((n) => n.budget?.contribution ?? 0),
      forecastTake: sum((n) => (n.actual ?? n.projection).take),
      forecastContribution: sum((n) => (n.actual ?? n.projection).contribution),
      actualTake: sum((n) => n.actual?.take ?? 0),
      actualContribution: sum((n) => n.actual?.contribution ?? 0),
      variance,
      unbudgeted,
      running,
      effects,
      driver: variance === null ? null : driverOf(effects),
    }
  })
}

// ------------------------------------------------------------ re-forecast ---

export interface Rates {
  /** Actual heads over budgeted heads. */
  turnout: number
  /** Actual spend per head over budgeted spend per head. */
  spend: number
  /** Actual margin after stock over the actual GST-exclusive take. */
  marginPct: number
  /** How many nights the rates were read off. */
  nights: number
}

const TRAILING_MONTHS = 3
const MIN_NIGHTS = 2

/**
 * How recent nights have run against their budgets.
 *
 * Read off nights with a budget, a closed bar and a counted door, in the last
 * three months. Fewer than two such nights is not a rate — one bad Tuesday
 * should not re-price the rest of the year.
 */
export function trailingRates(
  events: BarEventSummary[],
  now: Date,
  months = TRAILING_MONTHS,
): Rates | null {
  const from = new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
  const nights = events.filter(
    (e) =>
      e.date >= from &&
      e.date <= now &&
      e.budget !== null &&
      e.actual !== null &&
      (e.budget.heads ?? 0) > 0 &&
      (e.actual.heads ?? 0) > 0,
  )
  if (nights.length < MIN_NIGHTS) return null

  const sum = (pick: (e: BarEventSummary) => number) => nights.reduce((a, n) => a + pick(n), 0)
  const actualHeads = sum((n) => n.actual!.heads!)
  const budgetHeads = sum((n) => n.budget!.heads!)
  const actualTake = sum((n) => n.actual!.take)
  const budgetTake = sum((n) => n.budget!.take)
  const actualTakeEx = sum((n) => n.actual!.takeEx)

  return {
    turnout: actualHeads / budgetHeads,
    spend: budgetTake > 0 ? actualTake / actualHeads / (budgetTake / budgetHeads) : 1,
    marginPct: pctOf(
      sum((n) => n.actual!.margin),
      actualTakeEx,
    ),
    nights: nights.length,
  }
}

/** A planned night re-priced at recent rates. Its labour is left as planned. */
export function reforecast(night: BarNight, rates: Rates): BarNight {
  const heads = Math.round((night.heads ?? 0) * rates.turnout)
  const spendPerHead = (night.spendPerHead ?? 0) * rates.spend
  const take = heads * spendPerHead
  const takeEx = take / CFG.gst
  const margin = takeEx * rates.marginPct
  return {
    heads,
    take,
    takeEx,
    stockCost: takeEx - margin,
    margin,
    marginPct: rates.marginPct,
    spendPerHead,
    labourHours: night.labourHours,
    labour: night.labour,
    contribution: margin - night.labour,
  }
}

/**
 * If recent nights keep running the way they have, how big is the hole?
 *
 * Every night still to come is held to its budget where one is locked, and to
 * its projection where not, then re-priced at the trailing rates. Nights
 * already past are left out even if nobody has closed them — they happened,
 * and re-forecasting them would hide that their figures are missing.
 */
export function upcomingReforecast(
  events: BarEventSummary[],
  rates: Rates,
  now: Date,
): { nights: number; planned: number; reforecast: number; gap: number } {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const upcoming = events.filter((e) => e.actual === null && e.date >= startOfToday)

  const planned = upcoming.reduce((a, e) => a + (e.budget ?? e.projection).contribution, 0)
  const reforecasted = upcoming.reduce(
    (a, e) => a + reforecast(e.budget ?? e.projection, rates).contribution,
    0,
  )

  return {
    nights: upcoming.length,
    planned,
    reforecast: reforecasted,
    gap: reforecasted - planned,
  }
}

// ----------------------------------------------------------------- tones ---

/** How the prototype colours a bar margin. */
export const marginTone = (pct: number): Tone =>
  pct >= 0.5 ? 'good' : pct >= 0.3 ? 'warn' : 'stop'

export const varianceTone = (v: number | null): Tone =>
  v === null || Math.abs(v) < NOTHING_MOVED ? 'plain' : v > 0 ? 'good' : 'stop'

// ---------------------------------------------------------------- access ---

/**
 * Whether this user may open the bar at all.
 *
 * The bar is the venue's own trading. An outside coordinator has no business
 * reading its takings or its budget, and the months view has no single event
 * to scope them by — so an outside account is refused outright, whatever the
 * permission matrix says, rather than filtered.
 */
export function barRefusal(user: { external: boolean }): string | null {
  return user.external
    ? 'The bar is the venue’s own trading, so it is not something an outside account can open.'
    : null
}
