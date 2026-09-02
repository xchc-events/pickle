import { CFG } from './finance'
import { money } from './format'

/**
 * Hours.
 *
 * Ported from `hoursVals` and the org-wide apportionment in the design
 * prototype (docs/design-handoff/design/Pickle Prototype.dc.html, near lines
 * 3047 and 6304). Specification, like `finance.ts` and `roster.ts`: every
 * figure here is somebody's wages, and the org-wide pool is what turns a quiet
 * month into an expensive one per event.
 *
 * The handoff calls this "the module that makes the profit share arguable",
 * and `effectOf` is where that lives — a sentence, shown before anybody
 * presses anything, saying whose surplus an hour comes out of.
 *
 * Pure over plain shapes, so all of it is testable without a database.
 */

/** Work against a named event. */
export const TEAMS = [
  'Event coordination',
  'Design & comms',
  'Comms / socials',
  'Production management',
  'Bar admin & accounting',
  'Tech production',
  'Front of house & door',
] as const

/**
 * Work that belongs to the organisation rather than to one show. Pooled by
 * month and apportioned across the events in that month — this is what
 * `orgShareHours` in finance.ts is fed from.
 */
export const ORG_ROLES = [
  'Venue administration',
  'Grant writing & reporting',
  'Bar admin & accounting',
  'Maintenance & working bees',
  'Marketing, org-wide',
  'Governance & meetings',
] as const

/**
 * Whether a name appears on the org-wide list.
 *
 * Note what this deliberately is *not*: a way to decide what kind of hour
 * something is. "Bar admin & accounting" is on both lists — reconciling one
 * event's bar is event work, keeping the bar's books is org-wide, and the
 * same person does both under the same name. The kind of an hour comes from
 * whether it hangs off an event, never from what it is called. See `splitOf`.
 */
export const isOrgRole = (role: string): boolean => (ORG_ROLES as readonly string[]).includes(role)

/** What an hour costs the venue. Always the loaded rate, never the base one. */
export const costOf = (hours: number): number => hours * CFG.loaded

// ------------------------------------------------------------------ months ---

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/** `2026-08`. Sortable as a string, which is the whole point of the format. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** `Aug 2026`. Falls through unrecognised input rather than throwing. */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  if (!m) return key

  const name = MONTH_NAMES[Number(m[2]) - 1]
  return name ? `${name} ${m[1]}` : key
}

/**
 * A month's org-wide pool, per event.
 *
 * Zero when no events ran. Those hours were still worked and still cost the
 * venue — they simply have nothing to be charged against, which is a fact
 * about a quiet month rather than an error.
 */
export function apportion(orgHours: number, eventsInMonth: number): number {
  if (eventsInMonth <= 0 || orgHours <= 0) return 0
  return Math.round((orgHours / eventsInMonth) * 10) / 10
}

// ------------------------------------------------------------------- split ---

export interface HourRow {
  hours: number
  /** Set when the row was written by the roster. */
  shiftId: string | null
  eventId: string | null
}

export interface HourSplit {
  /** Rostered, on the night. Never typed by a person. */
  onSite: number
  /** Work on a named event that was not a shift. */
  offSite: number
  /** Neither — the monthly pool. */
  org: number
  total: number
}

/**
 * The three kinds of hour, told apart by what each row hangs off.
 *
 * Not by role name, which cannot decide it — see `isOrgRole`.
 */
export function splitOf(rows: readonly HourRow[]): HourSplit {
  const split = { onSite: 0, offSite: 0, org: 0, total: 0 }

  for (const r of rows) {
    if (r.shiftId) split.onSite += r.hours
    else if (r.eventId) split.offSite += r.hours
    else split.org += r.hours
    split.total += r.hours
  }

  return split
}

// ------------------------------------------------------------------ effect ---

export type EffectTone = 'plain' | 'good' | 'warn'

export interface Effect {
  text: string
  tone: EffectTone
}

export interface EffectInput {
  hours: number
  kind: 'event' | 'org'
  role: string
  /** The event's name, or the month's label. */
  target: string
  /** Only meaningful for an org-wide entry. */
  eventsInMonth?: number
}

/**
 * Where this hour lands, in a sentence.
 *
 * This is the module's argument, not its decoration. A coordinator logging
 * four hours of design against a show is taking $134 off that show's surplus,
 * and the split at the end of the night is calculated from exactly that. The
 * prototype puts this under the form, before the entry is committed, so
 * nobody can say afterwards that they did not know where it went.
 */
export function effectOf(input: EffectInput): Effect {
  if (!(input.hours > 0)) {
    return {
      tone: 'plain',
      text: 'Enter your hours and this line tells you exactly where the money lands.',
    }
  }

  const cost = costOf(input.hours)

  if (input.kind === 'event') {
    return {
      tone: 'good',
      text: `${money(cost)} onto ${input.target}’s ${input.role.toLowerCase()} line, straight off its surplus.`,
    }
  }

  const n = input.eventsInMonth ?? 0
  if (n <= 0) {
    return {
      tone: 'warn',
      text: `${money(cost)} of work, and no events in ${input.target} to carry it. It still cost the venue — it is simply charged to nothing.`,
    }
  }

  return {
    tone: 'good',
    text: `${money(cost)} spread across ${n} event${n === 1 ? '' : 's'} in ${input.target} — ${money(cost / n)} each.`,
  }
}
