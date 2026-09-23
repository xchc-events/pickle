import { ASSET_SET, type EventAsset } from './design'
import { days } from './format'
import { BEATS, GATED_BEATS } from './promo'
import {
  LICENCE_WORD,
  gatesMessage,
  isLate,
  type ArtistStatus,
  type DealState,
  type Gate,
  type LeadKey,
  type LicenceState,
  type TechStatus,
} from './event-record'
import type { Verdict } from './payments'

/**
 * The parts of an event, and where each one stands.
 *
 * An event used to sit at one of eight stages — enquiry, negotiating,
 * confirmed, design, on sale, rostering, show week, payout — and move along
 * them in order, with a gate on every step. That is not how a night comes
 * together. A promoter sends the artwork for their whole tour with the
 * enquiry; tickets go up while the poster is still being argued over. So each
 * event carries a status on each of eight parts instead, and one running ahead
 * of another is a normal state rather than an impossible one. Decided 16
 * September 2026 — see the note under Pipeline in docs/design-handoff/README.md.
 *
 * What changed, and what did not:
 *
 *  - **Every condition the stage gates held survives**, on the part it belongs
 *    to, worded as it was and linked to the screen that fixes it.
 *    parts.test.ts lists them and fails if one goes missing.
 *  - **Only the booking is moved by hand.** It and putting a night to bed are
 *    the two moves still refused while a gate fails. Every other part's status
 *    is worked out from the records its own module keeps — the asset set, the
 *    listings, the shifts, the actuals — so it cannot disagree with them, and
 *    nobody types it.
 *  - **One order between parts still refuses:** tickets do not go on sale
 *    until the booking is confirmed. `canGoOnSale` is that rule, and Promotion
 *    asks it before Gather.rsvp is pushed live.
 *
 * Pure over plain shapes, like the gates before it, so the whole table can be
 * tested without a database.
 */

// ------------------------------------------------------------------ parts ---

export type PartKey =
  'booking' | 'design' | 'promo' | 'tickets' | 'licence' | 'tech' | 'roster' | 'settlement'

export interface PartDef {
  key: PartKey
  label: string
  /** Phosphor icon, regular weight. */
  icon: string
  /**
   * The nickname of the stage this part grew out of, where exactly one did.
   * The venue's own vocabulary, kept rather than lost with the stages. Show
   * week's "Cracked" has no heir: its gates went to Licence and Tech.
   */
  nick: string | null
}

/** In the order the pipeline reads them — roughly when each usually starts. */
export const PARTS: readonly PartDef[] = [
  { key: 'booking', label: 'Booking', icon: 'ph-handshake', nick: null },
  { key: 'design', label: 'Design', icon: 'ph-tag', nick: 'Labelling' },
  { key: 'promo', label: 'Promo', icon: 'ph-megaphone', nick: null },
  { key: 'tickets', label: 'Tickets', icon: 'ph-ticket', nick: 'On the Shelf' },
  { key: 'licence', label: 'Licence', icon: 'ph-certificate', nick: null },
  { key: 'tech', label: 'Tech', icon: 'ph-sliders', nick: null },
  { key: 'roster', label: 'Roster', icon: 'ph-users-three', nick: 'Crewing' },
  { key: 'settlement', label: 'Settlement', icon: 'ph-receipt', nick: 'Tasting Notes' },
]

const def = (key: PartKey): PartDef => PARTS.find((p) => p.key === key)!

// ---------------------------------------------------------------- booking ---

export type BookingStatus = 'enquiry' | 'negotiating' | 'confirmed'

export interface BookingStep {
  key: BookingStatus
  label: string
  /** The internal nickname, as the stage had it. Shown on the event record. */
  nick: string
  /**
   * Days the booking should sit here before somebody looks at it, or null
   * for no target. The stage targets of the three stages that were the
   * booking; a confirmed booking has nowhere further to go.
   */
  target: number | null
}

export const BOOKING: readonly BookingStep[] = [
  { key: 'enquiry', label: 'Enquiry', nick: 'Fresh', target: 3 },
  { key: 'negotiating', label: 'Negotiating', nick: 'Brining', target: 7 },
  { key: 'confirmed', label: 'Confirmed', nick: 'Sealed', target: null },
]

export const bookingStep = (status: BookingStatus): BookingStep =>
  BOOKING.find((b) => b.key === status) ?? BOOKING[0]!

/** One step on, or null from confirmed. A booking never skips a step. */
export function nextBooking(status: BookingStatus): BookingStatus | null {
  const i = BOOKING.findIndex((b) => b.key === status)
  return BOOKING[i + 1]?.key ?? null
}

/** A booking that has sat past its target wants somebody's attention. */
export function isPastBookingTarget(status: BookingStatus, days: number): boolean {
  const target = bookingStep(status).target
  return target !== null && days > target
}

/**
 * The one order between parts that still refuses.
 *
 * A show can be announced, designed, rigged and rostered before its terms are
 * agreed. It cannot sell a ticket: money taken for a night that may not
 * happen is money to hand back.
 */
export function canGoOnSale(e: { booking: BookingStatus }): Verdict {
  return e.booking === 'confirmed'
    ? { ok: true }
    : { ok: false, why: 'Tickets cannot go on sale until the booking is confirmed' }
}

// ------------------------------------------------------------------ input ---

export interface GateArtist {
  status: ArtistStatus
  /** Whether a press shot is on file for this act. */
  hasPromo: boolean
  hasBio: boolean
  hasTechRider: boolean
}

export interface GateChannel {
  live: boolean
  stale: boolean
}

export interface GateShift {
  assigned: boolean
  /** ASKED in our schema — the prototype calls it pencilled. */
  pencilled: boolean
}

/** One event, flattened for the parts. Built by src/lib/parts-input.ts. */
export interface PartsEvent {
  booking: BookingStatus
  /** Days the booking has sat at its current status. */
  bookingDays: number
  concluded: boolean
  /** Days until doors. Zero on the night itself, negative once it is past. */
  daysToDoor: number

  // --- the booking ---
  hasOwner: boolean
  dateTbc: boolean
  hasSpace: boolean
  kind: string | null
  promoter: string | null
  /** Whether this promoter has a portal account to be chased in. */
  hasPortal: boolean
  split: number
  dealState: DealState
  dealNote: string | null
  /** Fee floor and ceiling, from `financeVals`. Never recomputed here. */
  floor: number
  ceil: number
  artists: GateArtist[]

  // --- the night ---
  barClose: string | null
  doors: string | null
  allOut: string | null
  licence: LicenceState
  techStatus: TechStatus

  leads: Record<LeadKey, boolean>

  // --- design ---
  /** The rows that exist. A piece of the house set with no row is a draft. */
  assets: EventAsset[]
  /** Current artwork files on the set, leaving out any a scan blocked. */
  artworkFiles: number

  // --- promo ---
  channels: GateChannel[]
  beatsDone: number

  // --- tickets ---
  std: number
  /** Gather.rsvp is live. It is the source of truth for being on sale. */
  ticketsLive: boolean
  sold: number
  capacity: number

  // --- roster ---
  shifts: GateShift[]

  // --- settlement ---
  /** Rows in HourEntry against this event. */
  hoursLogged: number
  /** Tasks carrying a non-zero actual. */
  tasksWithActual: number
  /** The door half of the night is reconciled — see src/lib/actuals.ts. */
  doorCounted: boolean
  /** The bar half of the night is reconciled, off the till or by hand. */
  barClosed: boolean
}

// ----------------------------------------------------------------- output ---

/**
 * good = finished, plain = under way, dim = not started or not needed,
 * warn = wants attention, stop = blocked outright.
 */
export type PartTone = 'good' | 'warn' | 'stop' | 'plain' | 'dim'

export interface PartState extends PartDef {
  /** What the pipeline cell says: "signed off", "2 of 6", "on sale". */
  status: string
  /** The small line under it — "3d", "84 sold" — or null. */
  detail: string | null
  tone: PartTone
  /**
   * Whether this part is something to do on this event at all. A licence the
   * bar close does not need, and a settlement before the night, are not.
   */
  applies: boolean
  /** Every gate on this part is clear. */
  clear: boolean
  /**
   * The part is finished. For most parts that is the same as clear; the
   * booking is done when confirmed and settlement when put to bed, because
   * both are moved by a person rather than worked out.
   */
  done: boolean
  checks: Gate[]
}

const g = (label: string, ok: boolean, why: string, screen: string): Gate => ({
  label,
  ok,
  why,
  screen,
})

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
const allOk = (gates: Gate[]) => gates.every((x) => x.ok)
const failing = (gates: Gate[]) => gates.filter((x) => !x.ok).length

/** Declined acts are off the bill, so they are off every gate that counts acts. */
const liveActs = (e: PartsEvent) => e.artists.filter((a) => a.status !== 'declined')

// --------------------------------------------------------------- the parts ---

function bookingGates(e: PartsEvent): Gate[] {
  if (e.booking === 'enquiry') {
    return [
      g('An owner is named', e.hasOwner, 'Set Owner on the event record', 'event'),
      g('Date is locked', !e.dateTbc, 'The enquiry still says date TBC', 'event'),
      g('Space chosen', e.hasSpace, 'Pick the room this is booked into', 'event'),
      g('Kind of night set', !!e.kind, 'Live, DJs, or workshop — it drives the roster', 'tech'),
    ]
  }

  if (e.booking === 'negotiating') {
    const live = liveActs(e)
    return [
      g(
        'Booking contact named',
        !!e.promoter && !e.promoter.includes('unassigned'),
        'Name the promoter or the internal contact',
        'event',
      ),
      g(
        'At least one act confirmed',
        live.some((a) => a.status === 'confirmed'),
        'Everyone is still enquired or pencilled',
        'event',
      ),
      g(
        'Fee floor and ceiling agreed',
        e.floor > 0 && e.ceil >= e.floor,
        'Set a fee range on every act',
        'event',
      ),
      g('Split agreed', e.split > 0, 'Move the split slider to what you shook on', 'event'),
      g(
        'Terms agreed with the promoter',
        e.dealState === 'agreed',
        e.dealState === 'queried'
          ? `They queried it: ${e.dealNote ?? ''}`
          : e.hasPortal
            ? 'Waiting on them in their portal'
            : 'Record the agreement below once they say yes',
        'event',
      ),
      g('Bar close decided', !!e.barClose, 'The licence and the roster both hang off it', 'event'),
    ]
  }

  return []
}

function booking(e: PartsEvent): PartState {
  const checks = bookingGates(e)
  const confirmed = e.booking === 'confirmed'
  const queried = e.booking === 'negotiating' && e.dealState === 'queried'

  return {
    ...def('booking'),
    status: bookingStep(e.booking).label.toLowerCase(),
    detail: confirmed ? null : days(e.bookingDays),
    tone: confirmed
      ? 'good'
      : queried || isPastBookingTarget(e.booking, e.bookingDays)
        ? 'warn'
        : 'plain',
    applies: true,
    clear: allOk(checks),
    done: confirmed,
    checks,
  }
}

const tierKeys = (tier: 'hero' | 'lead') =>
  ASSET_SET.filter((a) => a.tier === tier).map((a) => a.key)

function design(e: PartsEvent): PartState {
  const row = (key: string) => e.assets.find((a) => a.key === key)
  const state = (key: string) => row(key)?.state ?? 'draft'

  const hero = tierKeys('hero')
  const lead = tierKeys('lead')
  // Hero and lead pieces are the ones that need a signature, approved or
  // not. Signed means APPROVED with a recorded signer — the owner's or the
  // promoter's, whichever it was (D6, 23 Sep 2026) — not `promoterSigned`,
  // which only says which side signed and stays false for an owner's
  // sign-off. See `maySignOff` in design.ts.
  const unsigned = [...hero, ...lead].filter(
    (k) => !(state(k) === 'approved' && row(k)?.signedById),
  ).length
  const missingBios = liveActs(e).filter((a) => !a.hasPromo || !a.hasBio).length

  const checks = [
    g('Design lead assigned', e.leads.design, 'Nobody owns the creative yet', 'event'),
    g(
      'Artist bios and pics in',
      missingBios === 0,
      // This used to say design cannot start without them. It can now, and
      // does — the gate is what it still needs before it is finished.
      'Design needs a press shot and a bio for every act' +
        (e.hasPortal ? ' — chase it in their portal' : ''),
      'design',
    ),
    g(
      'Both vertical cuts signed off',
      hero.every((k) => state(k) === 'approved'),
      'Short-form video is the whole promo plan',
      'design',
    ),
    g(
      'Event cover signed off',
      lead.every((k) => state(k) === 'approved'),
      'The cover is the event page and every share card',
      'design',
    ),
    g(
      'Listing copy signed off',
      state('listing') === 'approved',
      'One text, cut to fit each platform',
      'design',
    ),
    g(
      'Signed off by the owner or the promoter',
      // Escaped only when nobody could sign at all — no portal to chase a
      // promoter in, and no owner named. The owner can sign a piece off
      // now too, so having no portal no longer excuses an in-house event.
      (!e.hasPortal && !e.hasOwner) || unsigned === 0,
      `${unsigned} ${plural(unsigned, 'piece', 'pieces')} not signed off yet`,
      'design',
    ),
  ]
  const clear = allOk(checks)

  const total = ASSET_SET.length
  const approved = ASSET_SET.filter((a) => state(a.key) === 'approved').length
  const inReview = ASSET_SET.some((a) => state(a.key) === 'review')

  // With every piece approved, only these two gates can still hold the part.
  // "Signed off · 1 to clear" read as a contradiction (Connor, 22 Sep 2026),
  // so the cell says the art is signed off and names what is open instead.
  const open = [
    e.leads.design ? null : 'no lead',
    missingBios > 0
      ? `${missingBios} ${plural(missingBios, "act's", "acts'")} bios and pics to chase`
      : null,
  ].filter((s) => s !== null)

  const shown: Pick<PartState, 'status' | 'detail' | 'tone'> =
    approved === total && e.hasPortal && unsigned > 0
      ? { status: 'with promoter', detail: `${unsigned} to sign`, tone: 'warn' }
      : approved === total
        ? clear
          ? { status: 'signed off', detail: null, tone: 'good' }
          : {
              status: 'art signed off',
              detail: open.length === 1 ? open[0] : `${failing(checks)} to clear`,
              tone: 'plain',
            }
        : approved > 0 || inReview
          ? {
              status: `${approved} of ${total}`,
              detail: inReview ? 'in review' : null,
              tone: 'plain',
            }
          : e.artworkFiles > 0
            ? { status: 'assets in', detail: null, tone: 'plain' }
            : { status: 'not started', detail: null, tone: 'dim' }

  return { ...def('design'), ...shown, applies: true, clear, done: clear, checks }
}

function promo(e: PartsEvent): PartState {
  const total = e.channels.length
  const live = e.channels.filter((c) => c.live).length
  const notOut = total - live
  const stale = e.channels.filter((c) => c.stale).length

  const checks = [
    g('Promo lead assigned', e.leads.promo, 'Somebody has to actually post it', 'promo'),
    g(
      'Every channel listed or ticked off',
      notOut === 0,
      `${notOut} ${plural(notOut, 'channel', 'channels')} not out yet`,
      'promo',
    ),
    g(
      'Nothing stale on a listing',
      stale === 0,
      'Something changed here and never went out',
      'promo',
    ),
    g(
      'Announce and on-sale beats done',
      e.beatsDone >= GATED_BEATS,
      'Work the promo plan in order',
      'promo',
    ),
  ]
  const clear = allOk(checks)
  const beats = e.beatsDone > 0 ? `${e.beatsDone} of ${BEATS.length} beats` : null

  const shown: Pick<PartState, 'status' | 'detail' | 'tone'> =
    stale > 0
      ? { status: `${stale} stale`, detail: `${live} of ${total} out`, tone: 'warn' }
      : live === 0
        ? { status: 'not out', detail: beats, tone: 'dim' }
        : live < total
          ? { status: `${live} of ${total} out`, detail: beats, tone: 'plain' }
          : {
              status: 'all out',
              detail: clear ? null : (beats ?? `${failing(checks)} to clear`),
              tone: clear ? 'good' : 'plain',
            }

  // With no listings at all there is nothing out, whatever the gates say.
  return { ...def('promo'), ...shown, applies: true, clear, done: total > 0 && clear, checks }
}

function tickets(e: PartsEvent): PartState {
  const sale = canGoOnSale(e)

  const checks = [
    g('Ticketing lead assigned', e.leads.ticketing, 'Nobody owns ticketing yet', 'event'),
    g('Ticket tiers set', e.std > 0, 'Standard price is still zero', 'ticketing'),
    g('Booking confirmed', sale.ok, sale.ok ? '' : sale.why, 'event'),
    // "Door list pulled" tested exactly this — the door list is Gather's —
    // and is folded in here rather than kept as a second copy of one fact.
    g(
      'Tickets live on Gather.rsvp',
      e.ticketsLive,
      'Push Gather.rsvp live from Promotion',
      'promo',
    ),
  ]
  const clear = allOk(checks)

  const shown: Pick<PartState, 'status' | 'detail' | 'tone'> = e.ticketsLive
    ? {
        status: e.capacity > 0 && e.sold >= e.capacity ? 'sold out' : 'on sale',
        detail: `${e.sold} sold`,
        tone: clear ? 'good' : 'plain',
      }
    : e.std > 0
      ? { status: 'priced', detail: sale.ok ? 'not on sale' : 'awaits booking', tone: 'plain' }
      : { status: 'no price', detail: null, tone: 'dim' }

  return { ...def('tickets'), ...shown, applies: true, clear, done: clear, checks }
}

function licence(e: PartsEvent): PartState {
  const late = isLate(e.barClose)

  const checks = [
    g(
      'Licence filed if it is needed',
      !late || e.licence !== 'not_required',
      'Bar runs past midnight with no licence recorded',
      'event',
    ),
    g(
      'Special licence not denied',
      e.licence !== 'denied',
      'The council said no — change the bar close or the date',
      'event',
    ),
    g(
      'Licence confirmed if needed',
      !late || e.licence === 'confirmed',
      `Bar past midnight and the licence is ${LICENCE_WORD[e.licence]}`,
      'event',
    ),
  ]
  const clear = allOk(checks)

  const shown: Record<LicenceState, Pick<PartState, 'status' | 'tone'>> = {
    denied: { status: 'denied', tone: 'stop' },
    confirmed: { status: 'confirmed', tone: 'good' },
    applied_for: { status: 'applied', tone: 'plain' },
    required: { status: 'to apply', tone: clear ? 'plain' : 'warn' },
    not_required: late ? { status: 'needed', tone: 'warn' } : { status: 'not needed', tone: 'dim' },
  }

  return {
    ...def('licence'),
    ...shown[e.licence],
    detail: null,
    applies: late || e.licence !== 'not_required',
    clear,
    done: clear,
    checks,
  }
}

function tech(e: PartsEvent): PartState {
  const noRider = liveActs(e).filter((a) => !a.hasTechRider).length

  const checks = [
    g('Tech lead assigned', e.leads.tech, 'Nobody owns production', 'tech'),
    g('Tech plan confirmed', e.techStatus === 'confirmed', `Plan is still ${e.techStatus}`, 'tech'),
    g(
      'Tech riders in',
      noRider === 0,
      `${noRider} ${plural(noRider, 'act', 'acts')} without a rider`,
      'event',
    ),
    g(
      'Run times set',
      !!e.doors && !!e.allOut,
      'Doors and everyone-out drive every shift',
      'event',
    ),
    // The event record, not Bar: bar close is a run time and is set there.
    g('Bar session set', !!e.barClose, 'The bar breakdown needs a service window', 'event'),
  ]
  const clear = allOk(checks)

  const shown: Pick<PartState, 'status' | 'detail' | 'tone'> =
    e.techStatus === 'confirmed'
      ? {
          status: 'confirmed',
          detail: clear ? null : `${failing(checks)} to clear`,
          tone: clear ? 'good' : 'plain',
        }
      : {
          status: 'draft',
          detail: !e.leads.tech
            ? 'no lead'
            : noRider > 0
              ? `${noRider} ${plural(noRider, 'rider', 'riders')} out`
              : null,
          tone: e.leads.tech ? 'plain' : 'dim',
        }

  return { ...def('tech'), ...shown, applies: true, clear, done: clear, checks }
}

function roster(e: PartsEvent): PartState {
  const total = e.shifts.length
  const open = e.shifts.filter((s) => !s.assigned).length
  const pencilled = e.shifts.filter((s) => s.pencilled).length

  const checks = [
    g(
      'Every shift filled',
      open === 0,
      `${open} ${plural(open, 'shift', 'shifts')} still open`,
      'roster',
    ),
    g('Nothing left pencilled', pencilled === 0, 'Pencilled crew have not confirmed', 'roster'),
  ]
  const clear = allOk(checks)

  const shown: Pick<PartState, 'status' | 'detail' | 'tone'> =
    total === 0
      ? { status: 'no shifts', detail: null, tone: 'dim' }
      : open > 0
        ? { status: `${open} open`, detail: `of ${total}`, tone: 'plain' }
        : pencilled > 0
          ? { status: `${pencilled} pencilled`, detail: null, tone: 'plain' }
          : { status: 'filled', detail: null, tone: 'good' }

  // With no shifts there is nobody to roster yet, which is not the same as filled.
  return { ...def('roster'), ...shown, applies: true, clear, done: total > 0 && clear, checks }
}

function settlementGates(e: PartsEvent): Gate[] {
  return [
    g(
      'Hours logged for this event',
      e.hoursLogged > 0 || e.tasksWithActual > 0,
      'Nobody has logged their time',
      'hours',
    ),
    // Two halves, reconciled separately — see src/lib/actuals.ts. The gate
    // waits for both, names whichever is missing, and links to where that half
    // is entered: Bar while the bar is open, the event record for the door.
    g(
      'Actuals in',
      e.doorCounted && e.barClosed,
      !e.doorCounted && !e.barClosed
        ? 'Bar take and final ticket count not reconciled'
        : !e.barClosed
          ? 'Bar take not reconciled'
          : 'Final ticket count not reconciled',
      e.barClosed ? 'event' : 'bar',
    ),
  ]
}

function settlement(e: PartsEvent): PartState {
  const checks = settlementGates(e)
  const clear = allOk(checks)
  const base = { ...def('settlement'), clear, done: e.concluded, checks }

  if (e.concluded) return { ...base, status: 'closed', detail: null, tone: 'good', applies: true }
  if (e.booking !== 'confirmed') {
    return { ...base, status: 'not booked', detail: null, tone: 'dim', applies: false }
  }
  if (e.daysToDoor > 0) {
    return { ...base, status: 'not yet', detail: null, tone: 'dim', applies: false }
  }
  if (!e.doorCounted || !e.barClosed) {
    const detail = e.doorCounted ? 'bar' : e.barClosed ? 'door' : null
    return { ...base, status: 'to count', detail, tone: 'warn', applies: true }
  }
  return {
    ...base,
    status: 'counted',
    detail: clear ? 'ready' : 'hours out',
    tone: 'plain',
    applies: true,
  }
}

/** Every part of this event, in pipeline order. */
export function partsFor(e: PartsEvent): PartState[] {
  return [
    booking(e),
    design(e),
    promo(e),
    tickets(e),
    licence(e),
    tech(e),
    roster(e),
    settlement(e),
  ]
}

// ------------------------------------------------------------- next move ---

export interface NextMove {
  kind: 'booking' | 'settle'
  /** What the button says. */
  label: string
  /** The heading over the gates that stand in front of it. */
  title: string
  gates: Gate[]
  clear: boolean
  /** The line under the gates. */
  message: string
}

/**
 * The one thing a person presses next on this event, or null when there is
 * nothing to press.
 *
 * The booking comes first, while it is still moving. Once it is confirmed
 * there is nothing to press until the night has happened, and then only
 * putting it to bed — which is refused until the night is counted.
 */
export function nextMove(e: PartsEvent): NextMove | null {
  if (e.concluded) return null

  const to = nextBooking(e.booking)
  if (to) {
    const step = bookingStep(to)
    const gates = bookingGates(e)
    const confirming = to === 'confirmed'
    return {
      kind: 'booking',
      label: confirming ? 'Confirm the booking' : `Move to ${step.label}`,
      title: confirming ? 'Before the booking is confirmed' : `Before this moves to ${step.label}`,
      gates,
      clear: allOk(gates),
      message: gatesMessage(
        gates,
        confirming
          ? 'Everything is clear — the booking can be confirmed.'
          : `Everything is clear — this can move to ${step.label}.`,
      ),
    }
  }

  if (e.daysToDoor > 0) return null

  const gates = settlementGates(e)
  return {
    kind: 'settle',
    label: 'Put to bed',
    title: 'Before this is put to bed',
    gates,
    clear: allOk(gates),
    message: gatesMessage(gates, 'Everything is clear — this event can be put to bed.'),
  }
}
