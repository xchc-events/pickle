import { isLate } from './event-record'
import { money } from './format'
import {
  COV,
  COV_FALLBACK,
  financeVals,
  marginHealth,
  type FinanceArtist,
  type FinanceEvent,
  type FinanceVals,
} from './finance'
import { HOUSE_TASKS } from './intake'
import { shiftPlan, type RosterEvent } from './roster'

/**
 * The live model behind the enquiry form — what a night costs and what it
 * pays, worked out the moment somebody types a figure, before anything is
 * saved to an event.
 *
 * The enquirer is shown the night fully crewed — every shift on the standard
 * plan counted as worked — because that is what it costs when it actually
 * runs. A plan that only counted the shifts somebody happened to fill in
 * would show a surplus the night could never really keep, which is the one
 * thing this screen exists to stop somebody doing. And it is `financeVals` —
 * the same function the event record reads once the booking is real — that
 * turns those inputs into dollars. Nothing here recomputes money; it only
 * assembles the `FinanceEvent` `financeVals` reads.
 *
 * That is also the one place the two differ. The record counts crew as shifts
 * are assigned (`billableHours`), and an event made from this form has no
 * shifts yet, so its record reads a higher surplus than this did until the
 * night is rostered. Same function, same figures, a different answer to "who
 * is on" — and this one is the answer to give somebody asking whether the
 * night adds up.
 *
 * Pure, and imported by a client component — like intake.ts and
 * event-record.ts, no server import, no database, nothing from `next/*`.
 */

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

/** Outside COV's table, so a night with no date yet reads as COV_FALLBACK. */
const UNKNOWN_DOW = -1

export interface ModelInputs {
  /** A night — see night.ts. Null while the enquirer has not picked one yet. */
  date: Date | null
  space: { name: string; capacity: number; seatedCapacity: number } | null
  kind: string
  format: string
  /** Decides the late-bar roster windows — see `isLate`. */
  barClose: string | null
  std: number
  door: number
  /** [subsidised, standard, supporter, door], as FRACTIONS summing to 1. */
  mix: [number, number, number, number]
  att: [number, number, number]
  barHead: number
  gear: number
  adv: number
  sound: string
  crew: number
  tok: number
  /** Share of surplus to their people, 0–1. */
  split: number
  /** Every act on the bill, whatever its status — none of them count as declined. */
  acts: { low: number; high: number }[]
}

export interface ModelCrewRow {
  role: string
  hours: number
}

export interface EnquiryModel {
  /** `financeVals` for the chosen scenario — the one source of every dollar shown. */
  vals: FinanceVals
  dayName: string
  dayShare: number
  /** The standard roster for this kind of night — `shiftPlan`, every shift assigned. */
  crew: ModelCrewRow[]
  crewHours: number
  /** `HOUSE_TASKS`' estimates — off-site hours no roster row ever carries. */
  taskHours: number
  health: 'loss' | 'thin' | 'healthy'
  margin: number
}

/**
 * The night, modelled: what it costs fully crewed, and what it pays, for one
 * scenario.
 */
export function modelOf(inputs: ModelInputs, scen: 0 | 1 | 2): EnquiryModel {
  // A night is UTC midnight (night.ts), so the day of week is read in UTC —
  // the enquirer's own browser may be anywhere.
  const dow = inputs.date ? inputs.date.getUTCDay() : UNKNOWN_DOW
  const dayName = inputs.date ? DAY_NAMES[dow] : 'That night'
  const dayShare = COV[dow] ?? COV_FALLBACK

  const lateBar = isLate(inputs.barClose)
  const roster: RosterEvent = {
    space: inputs.space ?? { capacity: 0, seatedCapacity: 0 },
    format: inputs.format,
    kind: inputs.kind,
    att: inputs.att,
    lateBar,
  }
  const plan = shiftPlan(roster)
  const crew: ModelCrewRow[] = plan.map((s) => ({ role: s.role, hours: s.hours }))
  const crewHours = crew.reduce((n, s) => n + s.hours, 0)
  const taskHours = HOUSE_TASKS.reduce((n, t) => n + t.est, 0)

  const artists: FinanceArtist[] = inputs.acts.map((a) => ({
    status: 'enquired',
    low: a.low,
    high: a.high,
  }))

  const event: FinanceEvent = {
    dow,
    std: inputs.std,
    door: inputs.door,
    mix: inputs.mix,
    att: inputs.att,
    scen,
    barHead: inputs.barHead,
    gear: inputs.gear,
    adv: inputs.adv,
    sound: inputs.sound,
    crew: inputs.crew,
    tok: inputs.tok,
    split: inputs.split,
    artists,
    // Fully crewed: the standard plan, every shift counted as worked — the
    // night as it will cost when it runs.
    shifts: plan.map((s) => ({ hours: s.hours, assigned: true })),
    tasks: HOUSE_TASKS.map((t) => ({ est: t.est })),
    addons: [],
    orgShareHours: 0,
  }

  const vals = financeVals(event)
  const { health, margin } = marginHealth(vals)

  return { vals, dayName, dayShare, crew, crewHours, taskHours, health, margin }
}

/**
 * What the enquirer is told about the night — always asked of the LIKELY
 * scenario, because that is the one the venue plans staffing and ticketing
 * around, not the best case they are hoping for.
 */
export function verdictOf(likely: EnquiryModel): { tone: 'good' | 'warn' | 'stop'; text: string } {
  const { surplus } = likely.vals

  if (surplus < 0) {
    return {
      tone: 'stop',
      text: `On a likely turnout this night is ${money(-surplus)} short of paying everybody’s floor and our crew. Raise the ticket price, expect more people, add bar spend, or trim the costs.`,
    }
  }
  if (likely.health === 'thin') {
    return {
      tone: 'warn',
      text: `On a likely turnout it pays everybody, with ${money(surplus)} left — thin. One quiet night and it does not.`,
    }
  }
  return {
    tone: 'good',
    text: `On a likely turnout it pays everybody’s floor and our crew in full, with ${money(surplus)} left to share.`,
  }
}
