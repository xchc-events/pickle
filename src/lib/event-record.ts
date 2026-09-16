import type { Verdict } from './payments'

/**
 * The event record: its run times, its licence, and the shape of a gate.
 *
 * Ported from the `scEvent` screen in the design prototype
 * (docs/design-handoff/design/Pickle Prototype.dc.html, screen at 294).
 *
 * The gates themselves live in src/lib/parts.ts. They were one set per stage
 * here, back when an event moved through eight stages in order; each event
 * now carries a status per part, and every condition moved to the part it
 * belongs to. They are still specification: do not add, remove or soften one
 * without a decision recorded against a real booking.
 *
 * Everything here is pure over plain shapes, so it can be tested without a
 * database — which is the point, because the alternative is discovering a
 * wrong gate on the night.
 */

// ------------------------------------------------------------------ time ---

/**
 * The pick-lists for the three run times. Specification: these are the times
 * the venue actually offers, not a general time picker.
 */
export const DOOR_TIMES = [
  '4:00pm',
  '4:30pm',
  '5:00pm',
  '5:30pm',
  '6:00pm',
  '6:30pm',
  '7:00pm',
  '7:30pm',
  '8:00pm',
  '8:30pm',
  '9:00pm',
  '9:30pm',
  '10:00pm',
] as const

export const CLOSE_TIMES = [
  '8:00pm',
  '8:30pm',
  '9:00pm',
  '9:30pm',
  '10:00pm',
  '10:30pm',
  '11:00pm',
  '11:30pm',
  '12:00am',
  '12:30am',
  '1:00am',
  '1:30am',
  '2:00am',
  '2:30am',
  '3:00am',
] as const

export const OUT_TIMES = [
  '8:30pm',
  '9:00pm',
  '9:30pm',
  '10:00pm',
  '10:30pm',
  '11:00pm',
  '11:30pm',
  '12:00am',
  '12:30am',
  '1:00am',
  '1:30am',
  '2:00am',
  '2:30am',
  '3:00am',
  '3:30am',
] as const

/**
 * A run time as minutes from midnight, with hours after midnight carried past
 * 1440 rather than wrapping to the small hours of the same day.
 *
 * That carry is the whole point. A bar closing at 1:00am closes *after* one
 * closing at 11:00pm, and a naive parse makes it four hours earlier — which
 * would tell the licence gate that a 2am close needs no special licence.
 *
 * An unparseable time is 0, not an error: it reads as "not set yet", which is
 * what an empty field means on an enquiry.
 */
export function timeMinutes(t: string | null | undefined): number {
  const m = /^(\d{1,2}):(\d{2})(am|pm)$/.exec(t ?? '')
  if (!m) return 0

  let h = Number(m[1]) % 12
  if (m[3] === 'pm') h += 12

  let v = h * 60 + Number(m[2])
  // Before 6am is the far side of midnight, not the near side.
  if (m[3] === 'am' && h < 6) v += 1440
  return v
}

/** Whether a time falls after midnight — the trigger for a special licence. */
export const isLate = (t: string | null | undefined): boolean => timeMinutes(t) >= 1440

// ----------------------------------------------------------------- gates ---

export type LeadKey = 'ticketing' | 'design' | 'promo' | 'tech'
export type DealState = 'sent' | 'agreed' | 'queried'
export type LicenceState = 'not_required' | 'required' | 'applied_for' | 'confirmed' | 'denied'
export type TechStatus = 'draft' | 'confirmed'
export type ArtistStatus = 'enquired' | 'pencilled' | 'confirmed' | 'declined'

export interface Gate {
  label: string
  ok: boolean
  /** Why it fails, in the coordinator's own words. Shown verbatim. */
  why: string
  /** Which module fixes it. Drives the "Fix it" deep link. */
  screen: string
}

/** How the licence state reads inside a sentence. */
export const LICENCE_WORD: Record<LicenceState, string> = {
  not_required: 'not required',
  required: 'required',
  applied_for: 'applied for',
  confirmed: 'confirmed',
  denied: 'denied',
}

/** The licence choices, in the order the prototype offers them. */
export const LICENCE_STATES: readonly { value: LicenceState; label: string }[] = [
  { value: 'not_required', label: 'Not required' },
  { value: 'required', label: 'Required' },
  { value: 'applied_for', label: 'Applied for' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'denied', label: 'Denied' },
]

/** Whether every gate in a set is clear. */
export const canAdvance = (gates: Gate[]): boolean => gates.every((g) => g.ok)

/** "3 of 5 clear" — the count beside a gate list. */
export function gatesDoneLabel(gates: Gate[]): string {
  const done = gates.filter((g) => g.ok).length
  return `${done} of ${gates.length} clear`
}

/**
 * The line under a gate list.
 *
 * Names the first blocker rather than the count, because the count does not
 * tell a coordinator what to go and do. `whenClear` is what to say once
 * nothing holds it up, which depends on what the gates stand in front of.
 */
export function gatesMessage(gates: Gate[], whenClear: string): string {
  const blocked = gates.filter((g) => !g.ok)
  if (blocked.length === 0) return whenClear
  return blocked.length === 1
    ? `One thing holds this up: ${blocked[0]!.label.toLowerCase()}.`
    : `${blocked.length} things hold this up, starting with ${blocked[0]!.label.toLowerCase()}.`
}

// ------------------------------------------------------------------- who ---

/**
 * Whether this user may change the event record.
 *
 * Every action on the record is the venue's: moving its booking on or putting
 * it to bed, naming its leads, its licence, its run times, where the terms stand, its date, the night's
 * takings and the hold on the room. An external promoter can open the record
 * — `eventScope` hands them their own organisation's events, and Pipeline is
 * one of their two modules — but reading it is where that stops, whatever
 * their permission rows say. What the handoff has them answer for, agreeing or
 * querying the terms and signing off artwork, belongs in Sign-offs.
 *
 * The page asks the same question, so a control this refuses is absent rather
 * than a button that always says no.
 */
export function canChangeEventRecord(user: { external: boolean }): Verdict {
  if (user.external) {
    return {
      ok: false,
      why: 'Nothing changed — the event record is kept by the venue. Your coordinator can make this change.',
    }
  }
  return { ok: true }
}
