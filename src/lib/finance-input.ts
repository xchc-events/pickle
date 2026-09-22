import 'server-only'
import { db } from './db'
import { normaliseMix } from './ticketing'
import {
  billableHours,
  hourCost,
  PLANNED_HOUR_COST,
  type Employment,
  type FinanceEvent,
  type Scenario,
} from './finance'

/**
 * Assembling the input `financeVals` wants, from a loaded event row.
 *
 * This exists because the assembly was being written out longhand in every
 * module that needed a projection, and the copies had already drifted: the
 * Ticketing copy normalises the mix before pricing off it, the Pipeline copy
 * does not. Two places that both work out what a show is worth is two places
 * that can disagree about it — the thing this product exists to stop.
 *
 * The blended cost of an event's hours belongs here for the same reason. It
 * used to be worked out separately wherever a screen happened to have shift
 * data — which drifted the same way the assembly itself once did, so a night
 * an employee worked could settle at one rate on the event record and
 * another on the Pipeline. `financeInputFor` is the one place every caller
 * shares, so it is the one place the blend is allowed to live.
 *
 * `financeVals` itself stays in finance.ts, which is specification. Nothing
 * here computes money; it only decides which columns go in, and — for the
 * blend — whose hours they are.
 */

/** The columns a projection needs. Structural, so any select that covers it fits. */
export interface FinanceRow {
  date: Date
  std: number
  door: number
  mix: number[]
  att: number[]
  scen: number
  barHead: number
  gear: number
  adv: number
  sound: string | null
  crew: number
  tok: number
  split: number
  artists: { low: number; high: number; status: string }[]
  /** `person` is null for an open shift, or a data gap — either costs as a contractor. */
  shifts: { hours: number; personId: string | null; person: { employment: Employment } | null }[]
  tasks: { est: number; actual: number | null }[]
  addons: { kind: string; cost: number | null; hours: number | null }[]
}

/** The select that satisfies `FinanceRow`. Spread into an event query. */
export const FINANCE_SELECT = {
  date: true,
  std: true,
  door: true,
  mix: true,
  att: true,
  scen: true,
  barHead: true,
  gear: true,
  adv: true,
  sound: true,
  crew: true,
  tok: true,
  split: true,
  artists: { select: { low: true, high: true, status: true } },
  shifts: { select: { hours: true, personId: true, person: { select: { employment: true } } } },
  tasks: { select: { est: true, actual: true } },
  addons: { select: { kind: true, cost: true, hours: true } },
} as const

/**
 * The event, in the shape the settlement maths reads.
 *
 * The mix is normalised and the scenario clamped on the way in, so a row that
 * somehow holds proportions summing to 1.4 prices at the mix's own shape
 * rather than 40% over. `mixProblem` in ticketing.ts is what tells a
 * coordinator their mix is wrong; this makes sure the money does not quietly
 * inflate while they fix it.
 */
export function financeInputFor(
  row: FinanceRow,
  scen: Scenario,
  orgShareHours: number,
): FinanceEvent {
  const event: FinanceEvent = {
    dow: row.date.getDay(),
    std: row.std,
    door: row.door,
    mix: normaliseMix(row.mix),
    att: [row.att[0] ?? 0, row.att[1] ?? 0, row.att[2] ?? 0],
    scen,
    barHead: row.barHead,
    gear: row.gear,
    adv: row.adv,
    sound: row.sound,
    crew: row.crew,
    tok: row.tok,
    split: row.split,
    artists: row.artists.map((a) => ({
      low: a.low,
      high: a.high,
      status: a.status.toLowerCase() as FinanceEvent['artists'][number]['status'],
    })),
    shifts: row.shifts.map((s) => ({ hours: s.hours, assigned: s.personId !== null })),
    tasks: row.tasks.map((t) => ({ est: t.est, actual: t.actual })),
    addons: row.addons.map((a) => ({
      kind: a.kind.toLowerCase() as 'gear' | 'labour',
      cost: a.cost ?? undefined,
      hours: a.hours ?? undefined,
    })),
    orgShareHours,
  }

  return { ...event, hourCost: blendedHourCost(row, event) }
}

/**
 * The blended cost per hour of the people actually on this event's hours.
 *
 * Assigned shifts cost the person on them, at their own employment — a
 * missing person or employment (an open shift, or a data gap) costs as a
 * contractor, never free. Task hours and addon labour carry nobody's name at
 * all, so they always cost the planned rate. Undefined with no billable
 * hours: there is nothing to divide by, and `financeVals` reads that as "plan
 * this at the contractor rate" on its own.
 */
function blendedHourCost(row: FinanceRow, event: FinanceEvent): number | undefined {
  const totalHours = billableHours(event)
  if (totalHours <= 0) return undefined

  const named = row.shifts.filter((s) => s.personId !== null)
  const namedHours = named.reduce((n, s) => n + s.hours, 0)
  const namedCost = named.reduce(
    (n, s) => n + s.hours * hourCost(s.person?.employment ?? 'CONTRACTOR'),
    0,
  )
  const plannedHours = totalHours - namedHours

  return (namedCost + plannedHours * PLANNED_HOUR_COST) / totalHours
}

/** A stored scenario index, clamped into the three the model knows. */
export const scenarioOf = (scen: number): Scenario =>
  Math.min(2, Math.max(0, Math.trunc(scen))) as Scenario

/**
 * Org-wide labour apportioned to one event, by its month.
 *
 * Hours logged against no event — admin, grants, maintenance — are pooled by
 * the month they were *worked* and divided across the events in it. `workedOn`
 * rather than `createdAt` is the whole point: an October hour typed up in
 * November belongs to October's shows.
 */
export async function orgShareFor(date: Date): Promise<number> {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
  const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1)

  const [orgHours, eventsThatMonth] = await Promise.all([
    db.hourEntry.aggregate({
      where: { eventId: null, workedOn: { gte: monthStart, lt: monthEnd } },
      _sum: { hours: true },
    }),
    db.event.count({ where: { date: { gte: monthStart, lt: monthEnd } } }),
  ])

  return eventsThatMonth > 0 ? (orgHours._sum.hours ?? 0) / eventsThatMonth : 0
}
