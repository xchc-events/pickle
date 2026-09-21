import { CLOSE_TIMES, DOOR_TIMES, OUT_TIMES, timeMinutes } from './event-record'
import { dateLabel } from './format'
import { nightFromInput, nightsBetween } from './night'
import type { Verdict } from './payments'
import {
  attendanceProblem,
  countProblem,
  dollarsProblem,
  feeProblem,
  MAX_CREW,
  MAX_TOKENS,
  splitProblem,
  tidyName,
} from './terms'
import { capacityOf } from './ticketing'
import { said, type Said } from './toast'

/**
 * Starting an enquiry — the rules behind the form at /events/new.
 *
 * Until this existed no application code could create an Event: every module
 * worked on rows the seed had made. The venue's own people and outside
 * promoters both start a booking here, through the one module they share
 * (Pipeline), and what differs between them is what each may *set*.
 *
 * That difference is the point of this file, and it is enforced here rather
 * than in the form. `cleanEnquiry` builds an outside account's enquiry from a
 * whitelist of the fields it was shown and fixes everything else, whatever the
 * request carried. The form leaving a field out is a convenience; the POST
 * behind it is reachable by anybody who can sign in.
 *
 * What the venue's form has to capture is decided by what nothing else can
 * write. The owner, the booking model, the split, attendance, the cost inputs,
 * the brief and every act's status and fees have no editor anywhere yet, so an
 * event that did not get them here would never get them. Ticket prices are
 * left out for the opposite reason: Ticketing already owns them.
 *
 * Pure over plain shapes, like event-record.ts and scope.ts, so every rule is
 * tested without a database — and because the form itself imports the
 * vocabulary from here, nothing in this file may reach for the server.
 */

// ------------------------------------------------------------ vocabulary ---

/**
 * The kinds of night. `kind` drives behaviour — the roster plans a workshop's
 * crew differently, and a live night gets a second sound engineer (see
 * `callFor` in roster.ts) — so these are the values the rest of the app
 * branches on, with the prototype's labels.
 */
export const KINDS = [
  { value: 'live', label: 'Live' },
  { value: 'djs', label: 'DJs' },
  { value: 'live-djs', label: 'Live + DJs' },
  { value: 'workshop', label: 'Workshop / community' },
] as const
export type Kind = (typeof KINDS)[number]['value']

/**
 * What the room is told it is. Only Cabaret is seated, which is what
 * `capacityOf` reads to pick the seated capacity.
 */
export const FORMATS = ['Live music', 'DJs', 'DJs + live', 'Cabaret'] as const
export type Format = (typeof FORMATS)[number]

/** The format a kind usually means — what the form preselects when the kind changes. */
export const FORMAT_FOR_KIND: Record<Kind, Format> = {
  live: 'Live music',
  djs: 'DJs',
  'live-djs': 'DJs + live',
  workshop: 'Cabaret',
}

/** `wheke` triggers the sliding-scale hire fee in finance.ts; anything else costs nothing. */
export const SOUNDS = [
  { value: 'inhouse', label: 'In-house system', note: 'No hire cost · the default' },
  { value: 'wheke', label: 'Wheke Sound', note: 'Sliding $300–$600 by event revenue' },
] as const
export type SoundKey = (typeof SOUNDS)[number]['value']

export const MODELS = [
  { value: 'curator', label: 'Curator model' },
  { value: 'dry', label: 'Dry hire' },
] as const
export type BookingModelKey = (typeof MODELS)[number]['value']

/** Declined is left out: nobody puts an act on a new booking to say they said no. */
export const ACT_STATUSES = [
  { value: 'enquired', label: 'Enquired' },
  { value: 'pencilled', label: 'Pencilled' },
  { value: 'confirmed', label: 'Confirmed' },
] as const
export type ActStatus = (typeof ACT_STATUSES)[number]['value']

export const MAX_ACTS = 12

/**
 * The off-site work every event is planned with.
 *
 * Ported from the prototype's `mk()` factory, which gives these five estimates
 * to every event. They are hours, and hours become the wage line, so an event
 * made without them would project a surplus the seeded ones never could — and
 * nothing else ever creates a Task row. `prisma/seed.ts` reads this list too,
 * so it is written down once.
 */
export const HOUSE_TASKS: readonly { name: string; est: number }[] = [
  { name: 'Event coordination', est: 9 },
  { name: 'Design & comms', est: 6 },
  { name: 'Comms / socials', est: 3 },
  { name: 'Production management', est: 1.5 },
  { name: 'Bar admin & accounting', est: 3 },
]

/**
 * Where the venue's form *starts* its figures, from the same factory.
 *
 * Shown in the form, editable, and submitted by a coordinator who looked at
 * them. Never applied silently, and never applied to an outside account's
 * enquiry: a figure nobody at the venue has seen does not belong on a P&L.
 */
export const HOUSE_STARTING_POINTS = {
  barHead: 20,
  gear: 200,
  adv: 100,
  crew: 6,
  tok: 2,
  sound: 'inhouse',
} as const

/** Quiet, likely and great as a share of the room — the prototype's spread. */
export const ATTENDANCE_SPREAD = [0.4, 0.62, 0.9] as const

export function usualAttendance(capacity: number): [number, number, number] {
  const [quiet, likely, great] = ATTENDANCE_SPREAD
  return [Math.round(capacity * quiet), Math.round(capacity * likely), Math.round(capacity * great)]
}

const isKind = (v: string): v is Kind => KINDS.some((k) => k.value === v)
const isFormat = (v: string): v is Format => (FORMATS as readonly string[]).includes(v)
const isModel = (v: string): v is BookingModelKey => MODELS.some((m) => m.value === v)
const isSound = (v: string): v is SoundKey => SOUNDS.some((s) => s.value === v)
const isActStatus = (v: string): v is ActStatus => ACT_STATUSES.some((a) => a.value === v)

// ------------------------------------------------------------------- who ---

/** Who is filling the form in, as far as the rules care. */
export interface IntakeUser {
  external: boolean
  /** The organisation an outside account acts for — a `Payee` id. */
  organisationId: string | null
}

const NO_ORGANISATION =
  'This account is not attached to a promoter organisation yet, so an enquiry would have nowhere to belong. Your coordinator at the venue can set that up.'

/**
 * Whether this account may start an enquiry at all.
 *
 * Anybody inside the venue who can open Pipeline may — the module is checked
 * separately, by `requireModule`. An outside account may once it has an
 * organisation: the event is scoped back to them by `Event.promoterId`, so
 * without one they would be making a booking they could never see again.
 */
export function mayStartEnquiry(user: IntakeUser): Verdict {
  if (user.external && !user.organisationId) return { ok: false, why: NO_ORGANISATION }
  return { ok: true }
}

// ---------------------------------------------------------------- shapes ---

export interface IntakeSpace {
  id: string
  name: string
  capacity: number
  seatedCapacity: number
}

export interface IntakeContext {
  user: IntakeUser
  /** Tonight at the venue — `venueToday()`. Passed in so the rules stay pure. */
  today: Date
  spaces: readonly IntakeSpace[]
}

export interface RawAct {
  name: string
  status: string
  low: string
  high: string
}

/** The form exactly as typed. Nothing in it is trusted. */
export interface RawEnquiry {
  name: string
  date: string
  dateTbc: boolean
  spaceId: string
  kind: string
  format: string
  doors: string
  barClose: string
  allOut: string
  acts: RawAct[]
  note: string

  // --- the venue's own. Read for staff; never read for an outside account. ---
  ownerId: string
  model: string
  /** 'venue' | 'organisation' | 'name' */
  bringing: string
  organisationId: string
  promoterName: string
  /** A percentage, as typed: "62". */
  split: string
  attQuiet: string
  attLikely: string
  attGreat: string
  barHead: string
  gear: string
  adv: string
  sound: string
  crew: string
  tok: string
  brief: string
  hold: boolean
}

export interface CleanAct {
  name: string
  status: ActStatus
  low: number
  high: number
}

/**
 * Who is bringing the night. Only `organisation` scopes anybody to the event;
 * a typed name is what the pipeline shows and decides nothing about access.
 */
export type Bringing =
  { by: 'venue' } | { by: 'organisation'; organisationId: string } | { by: 'name'; name: string }

export interface CleanEnquiry {
  name: string
  /** A night — see night.ts. */
  date: Date
  dateTbc: boolean
  spaceId: string
  kind: Kind
  format: Format
  doors: string | null
  barClose: string | null
  allOut: string | null
  acts: CleanAct[]
  note: string | null
  ownerId: string | null
  model: BookingModelKey
  bringing: Bringing
  /** 0–1, as the schema stores it. */
  split: number
  att: [number, number, number]
  barHead: number
  gear: number
  adv: number
  sound: SoundKey
  crew: number
  tok: number
  brief: string | null
  hold: boolean
}

/** What an outside account gets to say: the night, the room, what it is, who is on. */
type Theirs = Pick<
  CleanEnquiry,
  | 'name'
  | 'date'
  | 'spaceId'
  | 'kind'
  | 'format'
  | 'doors'
  | 'barClose'
  | 'allOut'
  | 'acts'
  | 'note'
>

/** Everything else, which is the venue's to say. */
type VenueOnly = Omit<CleanEnquiry, keyof Theirs>

export type FieldKey =
  | 'name'
  | 'date'
  | 'spaceId'
  | 'kind'
  | 'format'
  | 'doors'
  | 'barClose'
  | 'allOut'
  | 'acts'
  | 'note'
  | 'ownerId'
  | 'model'
  | 'bringing'
  | 'organisationId'
  | 'promoterName'
  | 'split'
  | 'att'
  | 'barHead'
  | 'gear'
  | 'adv'
  | 'sound'
  | 'crew'
  | 'tok'
  | 'brief'

export type FieldErrors = Partial<Record<FieldKey, string>>

export type Cleaned = { ok: true; value: CleanEnquiry } | { ok: false; errors: FieldErrors }

/** The fields in the order the form shows them. */
export const FIELD_ORDER: readonly FieldKey[] = [
  'name',
  'date',
  'spaceId',
  'kind',
  'format',
  'doors',
  'barClose',
  'allOut',
  'acts',
  'note',
  'ownerId',
  'model',
  'bringing',
  'organisationId',
  'promoterName',
  'split',
  'att',
  'barHead',
  'gear',
  'adv',
  'sound',
  'crew',
  'tok',
  'brief',
]

/** The first problem in form order — what the toast says, and where focus goes. */
export function firstError(errors: FieldErrors): string | null {
  for (const key of FIELD_ORDER) {
    const why = errors[key]
    if (why) return why
  }
  return null
}

// -------------------------------------------------------------- cleaning ---

/** A year back is a night being put on the books late. Further is a typo in the year. */
const MAX_NIGHTS_BACK = 366
const MAX_NIGHTS_AHEAD = 1100

const clear = (errors: FieldErrors): boolean => Object.keys(errors).length === 0

/**
 * A typed figure: blank is 0, anything that is not a plain number is null.
 *
 * Refused rather than read generously. `Number` would take "0x10" as sixteen
 * and "1e3" as a thousand, and every one of these figures reaches a settlement
 * and then a person — the same reasoning as `cleanDoor` in actuals.ts.
 */
function figure(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return 0
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null
}

/** A run time: blank is "not decided", otherwise one the venue actually offers. */
function runTime(raw: string, offered: readonly string[]): { value: string | null; bad: boolean } {
  const t = raw.trim()
  if (t === '') return { value: null, bad: false }
  return offered.includes(t) ? { value: t, bad: false } : { value: null, bad: true }
}

/**
 * The bill. One message for the whole section — the first thing wrong with it
 * — because the form shows it under the acts rather than under a row.
 *
 * An outside account names its acts and that is all: every one goes on as
 * enquired with no fee, whatever came with it. A fee floor and ceiling are what
 * the venue agrees to pay, and the status is the venue's record of where that
 * conversation stands.
 */
function cleanActs(rows: readonly RawAct[], external: boolean, errors: FieldErrors): CleanAct[] {
  const acts: CleanAct[] = []
  let problem: string | null = null
  const fail = (why: string) => {
    problem ??= why
  }

  for (const row of rows) {
    const name = tidyName(row.name)

    if (external) {
      if (name === '') continue
      if (name.length > 80) fail("Keep each act's name under 80 characters.")
      acts.push({ name, status: 'enquired', low: 0, high: 0 })
      continue
    }

    const lowTyped = row.low.trim()
    const highTyped = row.high.trim()
    // A row nobody filled in is not a mistake. A fee with nobody's name on it is.
    if (name === '' && lowTyped === '' && highTyped === '') continue
    if (name === '') {
      fail('Name the act those fees are for.')
      continue
    }
    if (name.length > 80) fail("Keep each act's name under 80 characters.")

    const statusTyped = row.status.trim()
    const status = statusTyped === '' ? 'enquired' : statusTyped
    if (!isActStatus(status)) fail('Each act is enquired, pencilled or confirmed.')

    const low = figure(lowTyped)
    const high = figure(highTyped)
    const feeIssue = feeProblem(low ?? NaN, high ?? NaN)
    if (feeIssue) fail(feeIssue)

    acts.push({
      name,
      status: isActStatus(status) ? status : 'enquired',
      low: low ?? 0,
      high: high ?? 0,
    })
  }

  if (acts.length > MAX_ACTS) {
    fail('Twelve acts is the most one booking takes — put the rest in the note.')
  }
  if (problem) errors.acts = problem
  return acts
}

/**
 * The part of the form anybody may fill in.
 *
 * `theirs` is null while any of it cannot be made sense of; `errors` says
 * what. The room and the format come back on their own as well, because the
 * venue's attendance check wants the room's capacity even when, say, the name
 * is what is wrong — every problem is reported at once, not one a submit.
 */
function cleanTheirs(
  raw: RawEnquiry,
  ctx: IntakeContext,
  errors: FieldErrors,
): { theirs: Theirs | null; space: IntakeSpace | null; format: Format | null } {
  const external = ctx.user.external

  const name = tidyName(raw.name)
  if (name.length < 2) errors.name = 'Give the event a name — it is what every screen calls it.'
  else if (name.length > 120) errors.name = 'Keep the name under 120 characters.'

  const date = nightFromInput(raw.date.trim())
  if (!date) {
    errors.date = 'Pick the night.'
  } else {
    // The venue may put a night on the books after it has happened. A promoter
    // asking for one that has been is asking for nothing.
    const away = nightsBetween(ctx.today, date)
    if (external && away < 0) {
      errors.date = 'That night has already been — pick one still to come.'
    } else if (!external && away < -MAX_NIGHTS_BACK) {
      errors.date = 'That is more than a year ago — check the year.'
    } else if (away > MAX_NIGHTS_AHEAD) {
      errors.date = 'That is more than three years out — check the year.'
    }
  }

  const spaceId = raw.spaceId.trim()
  const space = ctx.spaces.find((s) => s.id === spaceId) ?? null
  if (!space) errors.spaceId = 'Pick the room this is booked into.'

  const kind = raw.kind.trim()
  if (!isKind(kind)) errors.kind = 'Say what kind of night it is — it drives the roster.'

  const format = raw.format.trim()
  if (!isFormat(format)) errors.format = 'Pick how the room is set.'

  const doors = runTime(raw.doors, DOOR_TIMES)
  const barClose = runTime(raw.barClose, CLOSE_TIMES)
  const allOut = runTime(raw.allOut, OUT_TIMES)
  if (doors.bad) errors.doors = 'Pick a time from the list.'
  if (barClose.bad) errors.barClose = 'Pick a time from the list.'
  if (allOut.bad) errors.allOut = 'Pick a time from the list.'

  // `timeMinutes` carries the small hours past midnight, so a 1:00am close is
  // after 8:00pm doors rather than seven hours before them.
  if (doors.value && barClose.value && timeMinutes(barClose.value) <= timeMinutes(doors.value)) {
    errors.barClose = 'The bar cannot close before the doors open.'
  }
  if (allOut.value && barClose.value) {
    if (timeMinutes(allOut.value) < timeMinutes(barClose.value)) {
      errors.allOut = 'Everyone out cannot be before the bar closes.'
    }
  } else if (allOut.value && doors.value) {
    if (timeMinutes(allOut.value) <= timeMinutes(doors.value)) {
      errors.allOut = 'Everyone out cannot be before the doors open.'
    }
  }

  const acts = cleanActs(raw.acts, external, errors)

  const noteTyped = raw.note.trim()
  if (noteTyped.length > 1000) errors.note = 'Keep the note under 1,000 characters.'
  const note = noteTyped === '' ? null : noteTyped

  const knownFormat = isFormat(format) ? format : null
  if (!date || !space || !isKind(kind) || !isFormat(format)) {
    return { theirs: null, space, format: knownFormat }
  }
  return {
    theirs: {
      name,
      date,
      spaceId,
      kind,
      format,
      doors: doors.value,
      barClose: barClose.value,
      allOut: allOut.value,
      acts,
      note,
    },
    space,
    format,
  }
}

/**
 * What the venue says about an outside account's enquiry, which is all of it.
 *
 * Their date is a preference until a coordinator locks it, so it arrives TBC.
 * Nobody owns it yet — it lands in the unclaimed queue on Home. It belongs to
 * the organisation on their *session*, never to one named in the request. And
 * nothing they typed is a figure: no split, no attendance, no costs, no hold
 * on the room. A promoter who could set those could write their own P&L, and
 * one who could place holds could block every Saturday of the summer.
 */
function venueSideOfTheirs(organisationId: string): VenueOnly {
  return {
    dateTbc: true,
    ownerId: null,
    model: 'curator',
    bringing: { by: 'organisation', organisationId },
    split: 0,
    att: [0, 0, 0],
    barHead: 0,
    gear: 0,
    adv: 0,
    sound: 'inhouse',
    crew: 0,
    tok: 0,
    brief: null,
    hold: false,
  }
}

/** The venue's own fields, from a coordinator's form. Null while any of it is wrong. */
function cleanVenueOnly(
  raw: RawEnquiry,
  room: { space: IntakeSpace | null; format: Format | null },
  errors: FieldErrors,
): VenueOnly | null {
  // Whether this person exists is the database's to answer, in intake-data.ts.
  const ownerTyped = raw.ownerId.trim()
  const ownerId = ownerTyped === '' ? null : ownerTyped

  const modelTyped = raw.model.trim()
  const model = modelTyped === '' ? 'curator' : modelTyped
  if (!isModel(model)) errors.model = 'Pick how the venue and the promoter are working together.'

  let bringing: Bringing | null = null
  const by = raw.bringing.trim()
  if (by === 'venue') {
    bringing = { by: 'venue' }
  } else if (by === 'organisation') {
    const organisationId = raw.organisationId.trim()
    if (organisationId === '') errors.organisationId = 'Pick the organisation bringing it.'
    else bringing = { by: 'organisation', organisationId }
  } else if (by === 'name') {
    const name = tidyName(raw.promoterName)
    if (name.length < 2 || name.length > 80) errors.promoterName = 'Name whoever is bringing it.'
    else bringing = { by: 'name', name }
  } else {
    errors.bringing = 'Say who is bringing this.'
  }

  // Typed as a percentage, stored as the share the schema keeps.
  const percent = figure(raw.split)
  const splitIssue = splitProblem(percent ?? NaN)
  if (splitIssue) errors.split = splitIssue
  const split = (percent ?? 0) / 100

  const heads: [number, number, number] = [
    figure(raw.attQuiet) ?? NaN,
    figure(raw.attLikely) ?? NaN,
    figure(raw.attGreat) ?? NaN,
  ]
  const roomInfo =
    room.space && room.format
      ? {
          name: room.space.name,
          holds: capacityOf(room.space, room.format),
          seated: room.format === 'Cabaret',
        }
      : null
  const attIssue = attendanceProblem(heads, roomInfo)
  let att: [number, number, number] = [0, 0, 0]
  if (attIssue) {
    errors.att = attIssue
  } else {
    att = heads
  }

  const dollars = (typed: string, key: 'barHead' | 'gear' | 'adv'): number => {
    const n = figure(typed)
    const issue = dollarsProblem(n ?? NaN)
    if (issue) {
      errors[key] = issue
      return 0
    }
    return n ?? 0
  }
  const barHead = dollars(raw.barHead, 'barHead')
  const gear = dollars(raw.gear, 'gear')
  const adv = dollars(raw.adv, 'adv')

  const soundTyped = raw.sound.trim()
  const sound = soundTyped === '' ? 'inhouse' : soundTyped
  if (!isSound(sound)) errors.sound = 'Pick the sound system.'

  const count = (typed: string, key: 'crew' | 'tok', most: number): number => {
    const n = figure(typed)
    const issue = countProblem(n ?? NaN, most)
    if (issue) {
      errors[key] = issue
      return 0
    }
    return n ?? 0
  }
  const crew = count(raw.crew, 'crew', MAX_CREW)
  const tok = count(raw.tok, 'tok', MAX_TOKENS)

  const briefTyped = raw.brief.trim()
  if (briefTyped.length > 280) {
    errors.brief = 'Keep the brief to a line or two — under 280 characters.'
  }
  const brief = briefTyped === '' ? null : briefTyped

  if (!isModel(model) || !isSound(sound) || !bringing) return null
  return {
    dateTbc: raw.dateTbc,
    ownerId,
    model,
    bringing,
    split,
    att,
    barHead,
    gear,
    adv,
    sound,
    crew,
    tok,
    brief,
    hold: raw.hold,
  }
}

/**
 * Turn what was typed into what is written — or say everything that is wrong
 * with it, one message a field.
 *
 * **Who is asking decides which fields are read at all.** For an outside
 * account the venue's own fields are never parsed, let alone trusted: the
 * enquiry is the whitelisted half (`cleanTheirs`) plus values fixed here
 * (`venueSideOfTheirs`), so a hand-written POST naming an owner, a split, a
 * fee or somebody else's organisation changes nothing. Junk in those fields is
 * not an error either — refusing an enquiry over a number nobody will read
 * would be a refusal with no reason behind it.
 *
 * Refuses rather than clamps, throughout: a figure that is nearly right goes
 * back to the person who typed it, not onto the record.
 */
export function cleanEnquiry(raw: RawEnquiry, ctx: IntakeContext): Cleaned {
  const errors: FieldErrors = {}

  if (ctx.user.external) {
    // `mayStartEnquiry` should already have turned them away. Said again here
    // because this is the function that decides where the event belongs.
    const organisationId = ctx.user.organisationId
    if (!organisationId) return { ok: false, errors: { organisationId: NO_ORGANISATION } }

    const { theirs } = cleanTheirs(raw, ctx, errors)
    if (!theirs || !clear(errors)) return { ok: false, errors }
    return { ok: true, value: { ...theirs, ...venueSideOfTheirs(organisationId) } }
  }

  const { theirs, space, format } = cleanTheirs(raw, ctx, errors)
  const venue = cleanVenueOnly(raw, { space, format }, errors)
  if (!theirs || !venue || !clear(errors)) return { ok: false, errors }
  return { ok: true, value: { ...theirs, ...venue } }
}

// ----------------------------------------------------------------- words ---

/**
 * The booking contact on one of the venue's own nights: "internal · Ana
 * Kelliher", or "internal · unassigned" with nobody named.
 *
 * The seed's convention, and not only display: the "Booking contact named"
 * gate in parts.ts refuses a promoter string containing "unassigned".
 */
export function internalContact(ownerName: string | null): string {
  return `internal · ${ownerName ?? 'unassigned'}`
}

/**
 * The event's first activity line, which follows the person's initials in the
 * feed. A note is carried verbatim, in quotes: it is the first thing a
 * promoter says to the venue about the night, and a coordinator picking the
 * enquiry up should read their words rather than a summary of them.
 */
export function startedLine(x: {
  external: boolean
  organisationName: string | null
  spaceName: string
  date: Date
  dateTbc: boolean
  note: string | null
}): string {
  const when = dateLabel(x.date)
  // An outside account's date is always a preference, so it says so instead
  // of carrying "date TBC" on every line.
  const line = x.external
    ? `sent this enquiry for ${x.organisationName ?? 'a promoter'} — ${x.spaceName}, preferred date ${when}`
    : `started this enquiry — ${x.spaceName}, ${when}${x.dateTbc ? ', date TBC' : ''}`
  return x.note ? `${line} — “${x.note}”` : line
}

/**
 * What the toast says: the consequence, not the action. For the venue that is
 * which of the Enquiry gates the new event is already waiting on.
 */
export function startedSaid(x: { external: boolean; hasOwner: boolean; dateTbc: boolean }): Said {
  if (x.external) {
    return said(
      'Sent — it is with the venue now. A coordinator will pick it up and settle the date with you.',
    )
  }

  const waitsOn: string[] = []
  if (!x.hasOwner) waitsOn.push('somebody owns it')
  if (x.dateTbc) waitsOn.push('the date is locked')

  return said(
    waitsOn.length === 0
      ? 'Enquiry started — nothing holds it at Enquiry, so it can move to Negotiating when you are ready.'
      : `Enquiry started — it waits at Enquiry until ${waitsOn.join(' and ')}.`,
  )
}

// ------------------------------------------------------------------ form ---

/** The form's field names, shared by the form that sends them and the reader below. */
export const FIELD = {
  name: 'name',
  date: 'date',
  dateTbc: 'dateTbc',
  spaceId: 'spaceId',
  kind: 'kind',
  format: 'format',
  doors: 'doors',
  barClose: 'barClose',
  allOut: 'allOut',
  note: 'note',
  actName: 'actName',
  actStatus: 'actStatus',
  actLow: 'actLow',
  actHigh: 'actHigh',
  ownerId: 'ownerId',
  model: 'model',
  bringing: 'bringing',
  organisationId: 'organisationId',
  promoterName: 'promoterName',
  split: 'split',
  attQuiet: 'attQuiet',
  attLikely: 'attLikely',
  attGreat: 'attGreat',
  barHead: 'barHead',
  gear: 'gear',
  adv: 'adv',
  sound: 'sound',
  crew: 'crew',
  tok: 'tok',
  brief: 'brief',
  hold: 'hold',
} as const

/**
 * Read a submitted form as typed.
 *
 * Nothing is trimmed, judged or defaulted here — that is `cleanEnquiry`'s job,
 * and keeping the two apart keeps every rule in one place. A missing field, or
 * a file where a string belongs, reads as blank. The acts arrive as four
 * parallel lists lined up by index; a short list is padded rather than letting
 * one row's fee slide onto another's name.
 */
export function readEnquiryForm(form: FormData): RawEnquiry {
  const text = (key: string): string => {
    const v = form.get(key)
    return typeof v === 'string' ? v : ''
  }
  const texts = (key: string): string[] =>
    form.getAll(key).map((v) => (typeof v === 'string' ? v : ''))
  const ticked = (key: string): boolean => text(key) === 'on'

  const names = texts(FIELD.actName)
  const statuses = texts(FIELD.actStatus)
  const lows = texts(FIELD.actLow)
  const highs = texts(FIELD.actHigh)
  const rows = Math.max(names.length, statuses.length, lows.length, highs.length)
  const acts: RawAct[] = Array.from({ length: rows }, (_, i) => ({
    name: names[i] ?? '',
    status: statuses[i] ?? '',
    low: lows[i] ?? '',
    high: highs[i] ?? '',
  }))

  return {
    name: text(FIELD.name),
    date: text(FIELD.date),
    dateTbc: ticked(FIELD.dateTbc),
    spaceId: text(FIELD.spaceId),
    kind: text(FIELD.kind),
    format: text(FIELD.format),
    doors: text(FIELD.doors),
    barClose: text(FIELD.barClose),
    allOut: text(FIELD.allOut),
    acts,
    note: text(FIELD.note),
    ownerId: text(FIELD.ownerId),
    model: text(FIELD.model),
    bringing: text(FIELD.bringing),
    organisationId: text(FIELD.organisationId),
    promoterName: text(FIELD.promoterName),
    split: text(FIELD.split),
    attQuiet: text(FIELD.attQuiet),
    attLikely: text(FIELD.attLikely),
    attGreat: text(FIELD.attGreat),
    barHead: text(FIELD.barHead),
    gear: text(FIELD.gear),
    adv: text(FIELD.adv),
    sound: text(FIELD.sound),
    crew: text(FIELD.crew),
    tok: text(FIELD.tok),
    brief: text(FIELD.brief),
    hold: ticked(FIELD.hold),
  }
}
