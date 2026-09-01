import { CFG } from './finance'

/**
 * Rostering.
 *
 * Ported from `genShifts` and the availability seed in the design prototype
 * (docs/design-handoff/design/Pickle Prototype.dc.html, near lines 2906 and
 * 3266). Treat this like `finance.ts`: it is specification, not an
 * implementation detail. Every window here is a real call the venue pays for,
 * and every role in `rolesFor` is a person who gets asked to come in.
 *
 * Do not adjust a window or add a role without a decision recorded against a
 * real event. The numbers reach the P&L through `callFor`.
 *
 * Pure functions over plain shapes, so all of it is testable without a
 * database — the same reason `design.ts` is shaped this way.
 */

/** Role → [start offset from doors, hours]. Negative start would be set-up. */
export const ROLE_WIN: Record<string, [number, number]> = {
  'Duty manager': [3, 6],
  'Bar staff': [3.5, 5],
  'Sound — Lead': [0, 8],
  'Sound — 2IC': [2, 5],
  'Lighting — Lead': [2, 3],
  Door: [3.75, 3.5],
  'Care team': [5, 2.5],
  'Set-up crew': [0, 0.75],
  'Clean-up crew': [9, 0.75],
}

/** The same roles on an event that finishes early — the bar shuts at 11. */
export const ROLE_WIN_EARLY: Record<string, [number, number]> = {
  'Duty manager': [2, 5.5],
  'Bar staff': [2.5, 4.5],
  'Sound — Lead': [0, 6.5],
  'Sound — 2IC': [1.5, 4],
  'Lighting — Lead': [1.5, 2.5],
  Door: [2.75, 3],
  'Care team': [3.5, 2],
  'Set-up crew': [0, 0.75],
  'Clean-up crew': [7.5, 0.75],
}

/** Anything not in the table gets a plain mid-evening call. */
const FALLBACK: [number, number] = [3, 4]

export const TECH_ROLES = ['Sound — Lead', 'Sound — 2IC', 'Lighting — Lead'] as const

export function windowFor(role: string, lateBar: boolean): [number, number] {
  const table = lateBar ? ROLE_WIN : ROLE_WIN_EARLY
  return table[role] ?? FALLBACK
}

export interface RosterEvent {
  spaceName: string
  format: string
  kind: string
  /** Attendance by scenario: [quiet, likely, great]. */
  att: readonly number[]
  /** False when the bar shuts early. */
  lateBar: boolean
}

const isApt = (e: RosterEvent) => e.spaceName === 'Apartment U1'

/**
 * How many people the room is expected to hold on the night.
 *
 * The *likely* scenario, never the optimistic one — staffing to the best case
 * means paying for a crew that is standing around on an ordinary night.
 * Unmodelled events fall back to 62% of capacity, which is the prototype's
 * own figure and roughly what the venue actually does.
 */
function likelyCrowd(e: RosterEvent): number {
  const cap = isApt(e) ? CFG.capApt : e.format === 'Cabaret' ? CFG.capSeated : CFG.capMusic
  const likely = e.att[1] ?? 0
  return likely > 0 ? likely : Math.round(cap * 0.62)
}

/**
 * Who is on, for this event.
 *
 * The list is deliberately not a set: two Door and two Care team on a busy
 * night are two separate people and two separate shifts.
 */
export function rolesFor(e: RosterEvent): string[] {
  // The upstairs room seats forty and runs early — one of each, no doubling
  // up. Crowd size does not enter into it; the room is the limit.
  if (isApt(e)) {
    return [
      'Duty manager',
      'Bar staff',
      'Sound — Lead',
      'Door',
      'Care team',
      'Set-up crew',
      'Clean-up crew',
    ]
  }

  const workshop = e.kind === 'workshop'
  const roles = ['Duty manager', 'Bar staff']

  if (likelyCrowd(e) > 140) roles.push('Bar staff')

  roles.push('Sound — Lead')
  if (e.kind === 'live' || e.kind === 'live-djs') roles.push('Sound — 2IC')

  roles.push('Lighting — Lead', 'Door')
  if (!workshop) roles.push('Door')

  roles.push('Care team')
  if (!workshop) roles.push('Care team')

  roles.push('Set-up crew', 'Set-up crew', 'Clean-up crew', 'Clean-up crew')
  return roles
}

export interface PlannedShift {
  role: string
  hours: number
  /** Offset in hours from doors. */
  start: number
}

/** Every shift this event needs, with its call. */
export function shiftPlan(e: RosterEvent): PlannedShift[] {
  const workshop = e.kind === 'workshop'

  return rolesFor(e).map((role) => {
    const [start, hours] = windowFor(role, e.lateBar)

    // A workshop's sound op is there for the session, not a full show call.
    if (workshop && role === 'Sound — Lead') {
      return { role, start, hours: isApt(e) ? 3 : 4 }
    }

    return { role, start, hours }
  })
}

/** Total crew hours the event is committed to. This reaches the P&L. */
export const callFor = (e: RosterEvent): number => shiftPlan(e).reduce((n, s) => n + s.hours, 0)

// ------------------------------------------------------------ availability ---

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Anything from 5pm is an evening shift. */
const EVENING_FROM = 17

/**
 * The key availability is stored against — "Fri-eve", "Mon-day".
 *
 * Derived from the event's own date rather than typed in, so an event that
 * moves takes its availability question with it.
 */
export function dayPeriod(when: Date): string {
  const day = DAYS[when.getDay()]
  return `${day}-${when.getHours() >= EVENING_FROM ? 'eve' : 'day'}`
}

export interface PersonAvailability {
  /** Paid hours a week they have said they can work. */
  weekly: number
  /** Hours on top of that they are willing to volunteer. */
  volunteer: number
  yes: readonly string[]
  no: readonly string[]
}

export type FitTone = 'good' | 'warn' | 'stop' | 'plain'

export interface Fit {
  tone: FitTone
  why: string
}

/**
 * Whether to put this person on this shift.
 *
 * Three things, in the order they override each other:
 *
 *  1. A stated *no* is a no. Somebody who told us they cannot do Monday
 *     evenings is not shown as available on a Monday evening, however short
 *     the roster is — the whole point of collecting availability is that it
 *     is not overridden quietly.
 *  2. Their cap is a warning rather than a refusal. People pick up extra
 *     shifts, and the duty manager is allowed to ask; what they are not
 *     allowed to do is not know.
 *  3. A stated *yes* is the only thing that reads as keen.
 *
 * Volunteer hours sit on top of the paid cap as headroom, because that is
 * what they are: hours the person offered beyond what they expect paying for.
 */
export function fitFor(
  avail: PersonAvailability,
  slot: string,
  bookedThisWeek: number,
  shiftHours: number,
): Fit {
  if (avail.no.includes(slot)) {
    return { tone: 'stop', why: 'They said they cannot do this slot.' }
  }

  const ceiling = avail.weekly + avail.volunteer
  if (bookedThisWeek + shiftHours > ceiling) {
    const over = Math.round((bookedThisWeek + shiftHours - ceiling) * 10) / 10
    return {
      tone: 'warn',
      why: `${over}h past the hours they said they had this week. You can still ask.`,
    }
  }

  if (avail.yes.includes(slot)) {
    return { tone: 'good', why: 'They said this slot suits them.' }
  }

  return { tone: 'plain', why: 'No view either way on this slot.' }
}

/** What is still uncovered, in the coordinator's own words, or nothing. */
export function shortfall(shifts: readonly { state: string }[]): string | null {
  const open = shifts.filter((s) => s.state === 'OPEN' || s.state === 'ASKED').length
  if (open === 0) return null
  return `${open} shift${open === 1 ? '' : 's'} unfilled`
}
