import { money } from './format'
import { said, type Said } from './toast'

/**
 * The number-level rules for an event's bill and its terms.
 *
 * The enquiry form sets these figures once, at creation, and the event record
 * changes them from then on — two different screens, two different moments,
 * one set of rules. Kept here rather than written twice, because two copies of
 * "what is a valid fee" would drift the moment one of them was edited on its
 * own. Every one of these figures reaches a settlement and then a person, so
 * each is refused outright rather than clamped to something nearby.
 *
 * Pure, like intake.ts and event-record.ts — no server import, so a client
 * component can call the same rule a form action does.
 */

export const MAX_DOLLARS = 100_000

/**
 * The most crew, and the most drink tokens a head, one night takes. Far past
 * anything the venue runs — they are here to catch a slipped key, not to set
 * policy.
 */
export const MAX_CREW = 100
export const MAX_TOKENS = 20

/** The prototype's `bumpFee` step — how far the floor/ceiling steppers move. */
export const FEE_STEP = 25

export const SPLIT_PRESETS = [
  { percent: 60, label: 'House standard 60/40' },
  { percent: 50, label: 'Even split' },
  { percent: 100, label: 'All to them' },
] as const

/** The venue's standing offer to an outside account, before a coordinator settles another. */
export const HOUSE_SPLIT_PERCENT: number = SPLIT_PRESETS[0].percent

/** The prototype's starting ticket mix — subsidised, standard, supporter, door — as percentages. */
export const HOUSE_MIX = [20, 40, 15, 25] as const

/** Every status an act on the bill can hold. */
export const BILL_STATUSES = [
  { value: 'enquired', label: 'Enquired' },
  { value: 'pencilled', label: 'Pencilled' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'declined', label: 'Declined' },
] as const
export type BillStatus = (typeof BILL_STATUSES)[number]['value']

export const isBillStatus = (v: string): v is BillStatus => BILL_STATUSES.some((s) => s.value === v)

// ------------------------------------------------------------- problems ---

/** An act's fee floor and ceiling. */
export function feeProblem(low: number, high: number): string | null {
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high < 0) {
    return 'A fee is a dollar figure, zero or more.'
  }
  if (low > MAX_DOLLARS || high > MAX_DOLLARS) return 'Check that fee — it is over $100,000.'
  if (high < low) return "An act's top fee cannot be under its floor."
  return null
}

/** The split, as a percentage of the surplus. */
export function splitProblem(percent: number): string | null {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return 'The split is a percentage from 0 to 100.'
  }
  return null
}

/** A ticket price — standard or door. */
export function priceProblem(n: number): string | null {
  if (!Number.isFinite(n) || n < 0 || n > 1000) {
    return 'A ticket price is a dollar figure, zero or more.'
  }
  return null
}

/**
 * The four-way ticket mix — subsidised, standard, supporter, door, in the
 * order `finance.ts` reads — as whole percentages that account for everybody
 * who buys a ticket.
 */
export function mixProblem(mix: readonly number[]): string | null {
  const isWhole = (n: number) => Number.isFinite(n) && n >= 0 && Number.isInteger(n)
  if (mix.length !== 4 || !mix.every(isWhole)) {
    return 'The mix is four whole percentages.'
  }
  if (mix.reduce((n, x) => n + x, 0) !== 100) {
    return 'The mix has to add up to 100% — everybody who comes buys one of the four.'
  }
  return null
}

/**
 * Quiet, likely and great, against the room they are booked into.
 *
 * The room is optional because the check runs before a room is always known
 * — the venue's own form asks for attendance before the room is confirmed.
 */
export function attendanceProblem(
  att: readonly [number, number, number],
  room: { name: string; holds: number; seated: boolean } | null,
): string | null {
  const [quiet, likely, great] = att
  if (att.some((n) => !Number.isFinite(n) || n < 0 || !Number.isInteger(n))) {
    return 'Attendance is a head count — whole numbers.'
  }
  if (quiet > likely || likely > great) {
    return 'Attendance runs quiet, likely, great — each at least the one before.'
  }
  if (room && great > room.holds) {
    return `${room.name} holds ${room.holds}${room.seated ? ' seated' : ''} — a great night cannot be more than that.`
  }
  return null
}

/** A plain dollar figure — bar spend, gear and hire, promotion. */
export function dollarsProblem(n: number): string | null {
  if (!Number.isFinite(n) || n < 0 || n > MAX_DOLLARS) {
    return 'That is a dollar figure, zero or more.'
  }
  return null
}

/** A whole-number count — crew, tokens — capped at `most`. */
export function countProblem(n: number, most: number): string | null {
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n) || n > most) {
    return 'Crew and tokens are whole numbers, zero or more.'
  }
  return null
}

/** An act's name, already tidied by `tidyName`. */
export function actNameProblem(name: string): string | null {
  if (name === '') return 'Give the act a name.'
  if (name.length > 80) return "Keep each act's name under 80 characters."
  return null
}

/** Trim and collapse inner whitespace — the one way a typed name is tidied. */
export const tidyName = (s: string): string => s.trim().replace(/\s+/g, ' ')

// ---------------------------------------------------------------- locks ---

/** What stops a change to the bill or the terms, whoever asks. Null when nothing does. */
export function lockedBecause(e: { concluded: boolean }): string | null {
  if (e.concluded) return 'This night is put to bed — its figures are the settlement’s now.'
  return null
}

/** What stops a change to one act's row. Null when nothing does. */
export function actLockedBecause(a: { name: string; paid: boolean }): string | null {
  if (a.paid) return `${a.name} has been paid — their line is part of the settlement now.`
  return null
}

/** What stops the booking model being switched. Null when nothing does. */
export function modelLockedBecause(e: {
  depositRaisedAt: Date | null
  invoiceRaisedAt: Date | null
}): string | null {
  if (e.depositRaisedAt || e.invoiceRaisedAt) {
    return 'A money milestone has already been raised on this booking — reverse it in Finance before switching the model.'
  }
  return null
}

// ---------------------------------------------------------------- words ---

/** What the toast says after an act's status changes. */
export function statusSaid(name: string, status: BillStatus): Said {
  if (status === 'declined') {
    return said(
      `${name} → declined. Their fee has come out of the floor, so the surplus moved.`,
      'warn',
    )
  }
  return said(`${name} → ${status}.`)
}

/** What the toast says after the split changes. */
export function splitSaid(percent: number): Said {
  if (percent === 0) {
    return said(
      'Split back to nothing agreed — the booking cannot be confirmed until it is set.',
      'warn',
    )
  }
  return said(
    `${percent}% of the surplus goes to their people — everybody’s floor is still paid first.`,
  )
}

/** What the toast says after the booking model changes. */
export function modelSaid(model: 'dry' | 'curator'): Said {
  if (model === 'dry') {
    return said('Dry hire — the first milestone is the 25% deposit invoice.')
  }
  // The prototype's line ended "with finance signing off in between"; the
  // advice process (docs/design-handoff/advice-process.md, 17 Sep 2026)
  // replaced that sign-off, so the copy no longer promises it.
  return said(
    'Curator model — step 1 booking enquiry, step 2 booking confirmed, then the settlement invoice.',
  )
}

export interface Figures {
  att: [number, number, number]
  barHead: number
  gear: number
  adv: number
  crew: number
  tok: number
}

/**
 * Whether a value has the shape of a set of figures at all.
 *
 * The rules above judge numbers. A server action is a POST anybody signed in
 * can write by hand, and one carrying no attendance, or a fee as a string,
 * would reach those rules and throw rather than be refused in words. NaN and
 * Infinity are numbers as far as this goes; the rules are what turn them away.
 */
export function isFigures(v: unknown): v is Figures {
  if (typeof v !== 'object' || v === null) return false
  const f = v as Record<string, unknown>
  const att = f.att
  if (!Array.isArray(att) || att.length !== 3 || !att.every((n) => typeof n === 'number')) {
    return false
  }
  return (['barHead', 'gear', 'adv', 'crew', 'tok'] as const).every((k) => typeof f[k] === 'number')
}

/**
 * The activity line naming only what changed, or null when nothing did.
 *
 * Money reads through `money()` so the line matches every other figure a
 * coordinator sees — whole dollars, thousands comma, no cents.
 */
export function figuresLine(before: Figures, after: Figures): string | null {
  const parts: string[] = []

  if (
    before.att[0] !== after.att[0] ||
    before.att[1] !== after.att[1] ||
    before.att[2] !== after.att[2]
  ) {
    parts.push(`attendance ${after.att[0]} / ${after.att[1]} / ${after.att[2]}`)
  }
  if (before.barHead !== after.barHead) parts.push(`bar spend ${money(after.barHead)} a head`)
  if (before.gear !== after.gear) parts.push(`gear and hire ${money(after.gear)}`)
  if (before.adv !== after.adv) parts.push(`promotion ${money(after.adv)}`)
  if (before.crew !== after.crew) parts.push(`crew of ${after.crew}`)
  if (before.tok !== after.tok) parts.push(`${after.tok} tokens a head`)

  return parts.length === 0 ? null : `changed the figures — ${parts.join(', ')}`
}
