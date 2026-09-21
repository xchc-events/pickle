import { dateLabel } from './format'
import { nightFromInput, nightsBetween } from './night'
import type { Verdict } from './payments'
import { clockFromInput, endNightFor, runProblems } from './run-times'
import {
  attendanceProblem,
  countProblem,
  dollarsProblem,
  feeProblem,
  HOUSE_MIX,
  HOUSE_SPLIT_PERCENT,
  MAX_CREW,
  MAX_TOKENS,
  mixProblem,
  priceProblem,
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
 * An outside account now proposes the model's figures — the prices, the mix,
 * who they expect, what it costs them, their people's fees — the same way a
 * coordinator does, because that is the whole point of the live panel beside
 * the form (`enquiry-model.ts`): the enquirer sees what the night pays before
 * they send it, and what they typed is what a coordinator corrects rather than
 * retypes afterwards. What stays the venue's to decide is what nobody outside
 * the building can settle: the owner, the hold, the date lock, each act's
 * status, the split, and whose organisation the booking belongs to.
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
 * Shown in the form, editable, and submitted by whoever looked at them. Never
 * applied silently.
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
  /** `<input type="time">` values — '20:15', not a pick-list label. */
  doors: string
  barClose: string
  allOut: string
  /** `<input type="date">` value. Blank lets `endNightFor` work one out. */
  endDate: string
  model: string
  /** A dollar figure, as typed: "25". */
  std: string
  door: string
  /** Four percentages, as typed: "20". Must sum to 100 once read. */
  mixSub: string
  mixStd: string
  mixSup: string
  mixDoor: string
  attQuiet: string
  attLikely: string
  attGreat: string
  barHead: string
  gear: string
  adv: string
  sound: string
  crew: string
  tok: string
  acts: RawAct[]
  note: string
  /** Alternate dates, `YYYY-MM-DD`. Either or both may be blank. */
  alt1: string
  alt2: string

  // --- the venue's own: who owns it, whose organisation it belongs to, the
  // split, the brief, the hold. Read for staff; never read for an outside
  // account. ---
  ownerId: string
  /** 'venue' | 'organisation' | 'name' */
  bringing: string
  organisationId: string
  promoterName: string
  /** A percentage, as typed: "62". */
  split: string
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
  /** A night — see night.ts. Null while no end has been settled. */
  endDate: Date | null
  model: BookingModelKey
  std: number
  door: number
  /** [subsidised, standard, supporter, door] — FRACTIONS summing to 1. */
  mix: [number, number, number, number]
  att: [number, number, number]
  barHead: number
  gear: number
  adv: number
  sound: SoundKey
  crew: number
  tok: number
  acts: CleanAct[]
  note: string | null
  /** Up to two other nights they could also do. */
  alternates: Date[]
  ownerId: string | null
  bringing: Bringing
  /** 0–1, as the schema stores it. */
  split: number
  brief: string | null
  hold: boolean
}

/**
 * What an outside account gets to say: the night, the room, what it is, who
 * is on, and — now that the enquirer models the night — every input the
 * model reads. Their proposal, corrected by the venue afterwards, never
 * re-typed.
 */
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
  | 'endDate'
  | 'model'
  | 'std'
  | 'door'
  | 'mix'
  | 'att'
  | 'barHead'
  | 'gear'
  | 'adv'
  | 'sound'
  | 'crew'
  | 'tok'
  | 'acts'
  | 'note'
  | 'alternates'
>

/**
 * What nobody outside the building can settle: the owner, the hold, the date
 * lock, the split, the brief, and whose organisation the booking belongs to.
 */
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
  | 'endDate'
  | 'acts'
  | 'note'
  | 'alternates'
  | 'ownerId'
  | 'model'
  | 'std'
  | 'door'
  | 'mix'
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
  'endDate',
  'acts',
  'note',
  'alternates',
  'ownerId',
  'model',
  'std',
  'door',
  'mix',
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

/**
 * The bill. One message for the whole section — the first thing wrong with it
 * — because the form shows it under the acts rather than under a row.
 *
 * An outside account's fee is their proposal now, corrected by the venue on
 * the event record — but the status stays the venue's record of where the
 * conversation stands, whatever the row claims.
 */
function cleanActs(rows: readonly RawAct[], external: boolean, errors: FieldErrors): CleanAct[] {
  const acts: CleanAct[] = []
  let problem: string | null = null
  const fail = (why: string) => {
    problem ??= why
  }

  for (const row of rows) {
    const name = tidyName(row.name)
    const lowTyped = row.low.trim()
    const highTyped = row.high.trim()

    // A row nobody filled in is not a mistake. A fee with nobody's name on it is.
    if (name === '' && lowTyped === '' && highTyped === '') continue
    if (name === '') {
      fail('Name the act those fees are for.')
      continue
    }
    if (name.length > 80) fail("Keep each act's name under 80 characters.")

    let status: ActStatus = 'enquired'
    if (!external) {
      const statusTyped = row.status.trim()
      const typed = statusTyped === '' ? 'enquired' : statusTyped
      if (!isActStatus(typed)) fail('Each act is enquired, pencilled or confirmed.')
      status = isActStatus(typed) ? typed : 'enquired'
    }

    const low = figure(lowTyped)
    const high = figure(highTyped)
    const feeIssue = feeProblem(low ?? NaN, high ?? NaN)
    if (feeIssue) fail(feeIssue)

    acts.push({ name, status, low: low ?? 0, high: high ?? 0 })
  }

  if (acts.length > MAX_ACTS) {
    fail('Twelve acts is the most one booking takes — put the rest in the note.')
  }
  if (problem) errors.acts = problem
  return acts
}

/**
 * Up to two other nights they could also do, alongside the one they asked
 * for — blank slots dropped, each checked the way the preferred date is.
 */
function cleanAlternates(raw: RawEnquiry, ctx: IntakeContext, errors: FieldErrors): Date[] {
  const typed = [raw.alt1, raw.alt2].map((t) => t.trim()).filter((t) => t !== '')
  const alternates: Date[] = []
  let problem: string | null = null
  const fail = (why: string) => {
    problem ??= why
  }

  for (const t of typed) {
    const d = nightFromInput(t)
    if (!d) {
      fail('That is not a date.')
      continue
    }
    if (ctx.user.external && nightsBetween(ctx.today, d) < 0) {
      fail('That night has already been — pick one still to come.')
      continue
    }
    alternates.push(d)
  }

  if (problem) errors.alternates = problem
  return alternates
}

/**
 * The part of the form anybody may fill in — now the model's inputs too, not
 * only the night and who is on. `theirs` is null while any of it cannot be
 * made sense of; `errors` says what.
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

  // Run times: any minute is allowed now, so a clock reading is only ever
  // refused for not being one at all. The relationship between them — doors
  // before bar close, an end after everyone is meant to be out — is
  // run-times.ts's `runProblems`, the same rule the event record uses.
  const clock = (typed: string, key: 'doors' | 'barClose' | 'allOut'): string | null => {
    const t = typed.trim()
    if (t === '') return null
    const value = clockFromInput(t)
    if (!value) errors[key] = 'That is not a time.'
    return value
  }
  const doors = clock(raw.doors, 'doors')
  const barClose = clock(raw.barClose, 'barClose')
  const allOut = clock(raw.allOut, 'allOut')

  const endDateTyped = raw.endDate.trim()
  let endDate: Date | null
  if (endDateTyped === '') {
    endDate = date ? endNightFor(date, doors, allOut) : null
  } else {
    endDate = nightFromInput(endDateTyped)
    if (!endDate) errors.endDate = 'Pick the night it ends.'
  }

  if (date) {
    const runErrors = runProblems({ date, doors, barClose, endDate, allOut })
    if (!errors.doors && runErrors.doors) errors.doors = runErrors.doors
    if (!errors.barClose && runErrors.barClose) errors.barClose = runErrors.barClose
    if (!errors.endDate && runErrors.endDate) errors.endDate = runErrors.endDate
    if (!errors.allOut && runErrors.allOut) errors.allOut = runErrors.allOut
  }

  const modelTyped = raw.model.trim()
  const model = modelTyped === '' ? 'curator' : modelTyped
  if (!isModel(model)) errors.model = 'Pick how the venue and the promoter are working together.'

  const price = (typed: string, key: 'std' | 'door'): number => {
    const n = figure(typed)
    const issue = priceProblem(n ?? NaN)
    if (issue) {
      errors[key] = issue
      return 0
    }
    return n ?? 0
  }
  const std = price(raw.std, 'std')
  const door = price(raw.door, 'door')

  const mixTyped: [string, string, string, string] = [
    raw.mixSub,
    raw.mixStd,
    raw.mixSup,
    raw.mixDoor,
  ]
  const mixBlank = mixTyped.every((t) => t.trim() === '')
  const mixPercent: [number, number, number, number] = mixBlank
    ? [...HOUSE_MIX]
    : [
        figure(mixTyped[0]) ?? NaN,
        figure(mixTyped[1]) ?? NaN,
        figure(mixTyped[2]) ?? NaN,
        figure(mixTyped[3]) ?? NaN,
      ]
  const mixIssue = mixProblem(mixPercent)
  if (mixIssue) errors.mix = mixIssue
  const mix: [number, number, number, number] = mixIssue
    ? [0, 0, 0, 0]
    : [mixPercent[0] / 100, mixPercent[1] / 100, mixPercent[2] / 100, mixPercent[3] / 100]

  const heads: [number, number, number] = [
    figure(raw.attQuiet) ?? NaN,
    figure(raw.attLikely) ?? NaN,
    figure(raw.attGreat) ?? NaN,
  ]
  const roomInfo =
    space && isFormat(format)
      ? { name: space.name, holds: capacityOf(space, format), seated: format === 'Cabaret' }
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

  const acts = cleanActs(raw.acts, external, errors)

  const noteTyped = raw.note.trim()
  if (noteTyped.length > 1000) errors.note = 'Keep the note under 1,000 characters.'
  const note = noteTyped === '' ? null : noteTyped

  const alternates = cleanAlternates(raw, ctx, errors)

  const knownFormat = isFormat(format) ? format : null
  if (!date || !space || !isKind(kind) || !isFormat(format) || !isModel(model) || !isSound(sound)) {
    return { theirs: null, space, format: knownFormat }
  }
  return {
    theirs: {
      name,
      date,
      spaceId,
      kind,
      format,
      doors,
      barClose,
      allOut,
      endDate,
      model,
      std,
      door,
      mix,
      att,
      barHead,
      gear,
      adv,
      sound,
      crew,
      tok,
      acts,
      note,
      alternates,
    },
    space,
    format,
  }
}

/**
 * What only the venue can say about an outside account's enquiry.
 *
 * Their date is a preference until a coordinator locks it, so it arrives TBC.
 * Nobody owns it yet — it lands in the unclaimed queue on Home. It belongs to
 * the organisation on their *session*, never to one named in the request. The
 * split stays the venue's standing offer until a coordinator settles another
 * with them; every act they named arrives enquired, whatever status they sent
 * — that is the venue's record of where the conversation stands, not theirs
 * to write. And nothing they typed holds the room or carries a brief only
 * staff have seen.
 */
function venueSideOfTheirs(organisationId: string): VenueOnly {
  return {
    dateTbc: true,
    ownerId: null,
    bringing: { by: 'organisation', organisationId },
    split: HOUSE_SPLIT_PERCENT / 100,
    brief: null,
    hold: false,
  }
}

/** The venue's own fields, from a coordinator's form. Null while any of it is wrong. */
function cleanVenueOnly(raw: RawEnquiry, errors: FieldErrors): VenueOnly | null {
  // Whether this person exists is the database's to answer, in intake-data.ts.
  const ownerTyped = raw.ownerId.trim()
  const ownerId = ownerTyped === '' ? null : ownerTyped

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

  const briefTyped = raw.brief.trim()
  if (briefTyped.length > 280) {
    errors.brief = 'Keep the brief to a line or two — under 280 characters.'
  }
  const brief = briefTyped === '' ? null : briefTyped

  if (!bringing) return null
  return {
    dateTbc: raw.dateTbc,
    ownerId,
    bringing,
    split,
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
 * (`venueSideOfTheirs`), so a hand-written POST naming an owner, a hold or
 * somebody else's organisation changes nothing. Junk in those fields is not
 * an error either — refusing an enquiry over a value nobody will read would
 * be a refusal with no reason behind it.
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

  const { theirs } = cleanTheirs(raw, ctx, errors)
  const venue = cleanVenueOnly(raw, errors)
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
  alternates: Date[]
}): string {
  const altSuffix =
    x.alternates.length === 0
      ? ''
      : x.alternates.length === 1
        ? ` (or ${dateLabel(x.alternates[0])})`
        : ` (or ${dateLabel(x.alternates[0])} or ${dateLabel(x.alternates[1])})`
  const when = dateLabel(x.date) + altSuffix
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
  endDate: 'endDate',
  model: 'model',
  std: 'std',
  door: 'door',
  mixSub: 'mixSub',
  mixStd: 'mixStd',
  mixSup: 'mixSup',
  mixDoor: 'mixDoor',
  attQuiet: 'attQuiet',
  attLikely: 'attLikely',
  attGreat: 'attGreat',
  barHead: 'barHead',
  gear: 'gear',
  adv: 'adv',
  sound: 'sound',
  crew: 'crew',
  tok: 'tok',
  actName: 'actName',
  actStatus: 'actStatus',
  actLow: 'actLow',
  actHigh: 'actHigh',
  note: 'note',
  alt1: 'alt1',
  alt2: 'alt2',
  ownerId: 'ownerId',
  bringing: 'bringing',
  organisationId: 'organisationId',
  promoterName: 'promoterName',
  split: 'split',
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
    endDate: text(FIELD.endDate),
    model: text(FIELD.model),
    std: text(FIELD.std),
    door: text(FIELD.door),
    mixSub: text(FIELD.mixSub),
    mixStd: text(FIELD.mixStd),
    mixSup: text(FIELD.mixSup),
    mixDoor: text(FIELD.mixDoor),
    attQuiet: text(FIELD.attQuiet),
    attLikely: text(FIELD.attLikely),
    attGreat: text(FIELD.attGreat),
    barHead: text(FIELD.barHead),
    gear: text(FIELD.gear),
    adv: text(FIELD.adv),
    sound: text(FIELD.sound),
    crew: text(FIELD.crew),
    tok: text(FIELD.tok),
    acts,
    note: text(FIELD.note),
    alt1: text(FIELD.alt1),
    alt2: text(FIELD.alt2),
    ownerId: text(FIELD.ownerId),
    bringing: text(FIELD.bringing),
    organisationId: text(FIELD.organisationId),
    promoterName: text(FIELD.promoterName),
    split: text(FIELD.split),
    brief: text(FIELD.brief),
    hold: ticked(FIELD.hold),
  }
}
