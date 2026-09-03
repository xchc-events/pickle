import { STAGES } from './constants'

/**
 * The event record, and the stage gates that govern it.
 *
 * Ported from `gates()` and the `scEvent` screen in the design prototype
 * (docs/design-handoff/design/Pickle Prototype.dc.html, gates near line 3413,
 * screen at 294).
 *
 * The gate sets are specification, like `finance.ts`. The handoff calls them
 * "the load-bearing interaction": an event cannot advance while a gate fails,
 * so a gate quietly dropped here is a show that goes on sale without artwork,
 * or a bar that runs past midnight without a licence. Do not add, remove or
 * soften a condition without a decision recorded against a real booking.
 *
 * Everything here is pure over plain shapes, so the whole gate table can be
 * tested without a database — which is the point, because the alternative is
 * discovering a wrong gate on the night.
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

export interface GateArtist {
  status: ArtistStatus
  /** Whether a press shot is on file for this act. */
  hasPromo: boolean
  hasBio: boolean
  hasTechRider: boolean
}

export interface GateAsset {
  key: string
  tier: 'hero' | 'lead' | 'support'
  state: 'draft' | 'review' | 'approved'
  promoterSigned: boolean
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

export interface GateEvent {
  stage: number
  hasOwner: boolean
  dateTbc: boolean
  hasSpace: boolean
  kind: string | null
  promoter: string | null
  internal: boolean
  /** Whether this promoter has a portal account to be chased in. */
  hasPortal: boolean
  split: number
  dealState: DealState
  dealNote: string | null
  barClose: string | null
  doors: string | null
  allOut: string | null
  licence: LicenceState
  std: number
  ticketsLive: boolean
  techStatus: TechStatus
  leads: Record<LeadKey, boolean>
  artists: GateArtist[]
  assets: GateAsset[]
  channels: GateChannel[]
  beatsDone: number
  shifts: GateShift[]
  /** Rows in HourEntry against this event. */
  hoursLogged: number
  /** Tasks carrying a non-zero actual. */
  tasksWithActual: number
  hasActual: boolean
  /** Fee floor and ceiling, from `financeVals`. Never recomputed here. */
  floor: number
  ceil: number
}

export interface Gate {
  label: string
  ok: boolean
  /** Why it fails, in the coordinator's own words. Shown verbatim. */
  why: string
  /** Which module fixes it. Drives the "Fix it" deep link. */
  screen: string
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * The gate set for the transition out of this event's current stage.
 *
 * Ported set for set. The eighth (Payout) has no transition after it, so its
 * conditions are what has to be true before the event is put to bed.
 */
export function gatesFor(e: GateEvent): Gate[] {
  const g = (label: string, ok: boolean, why: string, screen: string): Gate => ({
    label,
    ok,
    why,
    screen,
  })

  // Declined acts are off the bill, so they are off every gate that counts
  // acts — the same rule `financeVals` applies to the fee floor.
  const live = e.artists.filter((a) => a.status !== 'declined')
  const hero = e.assets.filter((a) => a.tier === 'hero')
  const lead = e.assets.filter((a) => a.tier === 'lead')
  const unsigned = e.assets.filter(
    (a) => (a.tier === 'hero' || a.tier === 'lead') && !a.promoterSigned,
  ).length
  const notOut = e.channels.filter((c) => !c.live).length
  const openShifts = e.shifts.filter((s) => !s.assigned).length
  const missingBios = live.filter((a) => !a.hasPromo || !a.hasBio).length
  const noRider = live.filter((a) => !a.hasTechRider).length

  const sets: Gate[][] = [
    // 0 Enquiry → Negotiating
    [
      g('An owner is named', e.hasOwner, 'Set Owner on the event record', 'event'),
      g('Date is locked', !e.dateTbc, 'The enquiry still says date TBC', 'event'),
      g('Space chosen', e.hasSpace, 'Pick Main, the Apartment, or both', 'event'),
      g('Kind of night set', !!e.kind, 'Live, DJs, or workshop — it drives the roster', 'tech'),
    ],
    // 1 Negotiating → Confirmed
    [
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
    ],
    // 2 Confirmed → Design
    [
      g('Ticketing lead assigned', e.leads.ticketing, 'Nobody owns ticketing yet', 'event'),
      g('Design lead assigned', e.leads.design, 'Nobody owns the creative yet', 'event'),
      g('Ticket tiers set', e.std > 0, 'Standard price is still zero', 'ticketing'),
      g(
        'Artist bios and pics in',
        missingBios === 0,
        'Design cannot start without promo pics and a bio' +
          (e.hasPortal ? ' — chase it in their portal' : ''),
        'design',
      ),
      g(
        'Licence filed if it is needed',
        !isLate(e.barClose) || e.licence !== 'not_required',
        'Bar runs past midnight with no licence recorded',
        'event',
      ),
      g(
        'Special licence not denied',
        e.licence !== 'denied',
        'The council said no — change the bar close or the date',
        'event',
      ),
    ],
    // 3 Design → On sale
    [
      g(
        'Both vertical cuts signed off',
        hero.every((a) => a.state === 'approved'),
        'Short-form video is the whole promo plan',
        'design',
      ),
      g(
        'Event cover signed off',
        lead.every((a) => a.state === 'approved'),
        'The cover is the event page and every share card',
        'design',
      ),
      g(
        'Listing copy signed off',
        e.assets.some((a) => a.key === 'listing' && a.state === 'approved'),
        'One text, cut to fit each platform',
        'design',
      ),
      g('Promo lead assigned', e.leads.promo, 'Somebody has to actually post it', 'promo'),
      g(
        'Promoter signed off the creative',
        !e.hasPortal || unsigned === 0,
        `${unsigned} ${plural(unsigned, 'piece', 'pieces')} not signed off in their portal`,
        'design',
      ),
    ],
    // 4 On sale → Rostering
    [
      g(
        'Tickets live on Gather.rsvp',
        e.ticketsLive,
        'Push ticketing live from the Ticketing module',
        'ticketing',
      ),
      g(
        'Every channel listed or ticked off',
        notOut === 0,
        `${notOut} ${plural(notOut, 'channel', 'channels')} not out yet`,
        'promo',
      ),
      g(
        'Nothing stale on a listing',
        e.channels.every((c) => !c.stale),
        'Something changed here and never went out',
        'promo',
      ),
      g(
        'Announce and on-sale beats done',
        e.beatsDone >= 2,
        'Work the promo plan in order',
        'promo',
      ),
    ],
    // 5 Rostering → Show week
    [
      g(
        'Every shift filled',
        openShifts === 0,
        `${openShifts} ${plural(openShifts, 'shift', 'shifts')} still open`,
        'roster',
      ),
      g(
        'Nothing left pencilled',
        e.shifts.every((s) => !s.pencilled),
        'Pencilled crew have not confirmed',
        'roster',
      ),
      g('Tech lead assigned', e.leads.tech, 'Nobody owns production', 'tech'),
      g(
        'Tech plan confirmed',
        e.techStatus === 'confirmed',
        `Plan is still ${e.techStatus}`,
        'tech',
      ),
      g(
        'Tech riders in',
        noRider === 0,
        `${noRider} ${plural(noRider, 'act', 'acts')} without a rider`,
        'event',
      ),
    ],
    // 6 Show week → Payout
    [
      g(
        'Licence confirmed if needed',
        !isLate(e.barClose) || e.licence === 'confirmed',
        `Bar past midnight and the licence is ${LICENCE_WORD[e.licence]}`,
        'event',
      ),
      g('Door list pulled', e.ticketsLive, 'Nothing to check people in against', 'ticketing'),
      g(
        'Run times set',
        !!e.doors && !!e.allOut,
        'Doors and everyone-out drive every shift',
        'event',
      ),
      g('Bar session set', !!e.barClose, 'The bar breakdown needs a service window', 'bar'),
    ],
    // 7 Payout
    [
      g(
        'Hours logged for this event',
        e.hoursLogged > 0 || e.tasksWithActual > 0,
        'Nobody has logged their time',
        'hours',
      ),
      g('Actuals in', e.hasActual, 'Bar take and final ticket count not reconciled', 'bar'),
    ],
  ]

  return sets[e.stage] ?? []
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

/** Whether every gate out of this stage is clear. */
export const canAdvance = (gates: Gate[]): boolean => gates.every((g) => g.ok)

/** What the advance button says. The last stage completes rather than moves. */
export const advanceLabel = (stage: number): string =>
  stage < STAGES.length - 1 ? `Move to ${STAGES[stage + 1]}` : 'Complete'

/** "3 of 5 clear" — the count beside the gate list. */
export function gatesDoneLabel(gates: Gate[]): string {
  const done = gates.filter((g) => g.ok).length
  return `${done} of ${gates.length} clear`
}

/**
 * The line under the gate list.
 *
 * Names the first blocker rather than the count, because the count does not
 * tell a coordinator what to go and do.
 */
export function gatesMessage(gates: Gate[], stage: number): string {
  const blocked = gates.filter((g) => !g.ok)
  if (blocked.length === 0) {
    return stage < STAGES.length - 1
      ? `Everything is clear — this can move to ${STAGES[stage + 1]}.`
      : 'Everything is clear — this event can be put to bed.'
  }
  return blocked.length === 1
    ? `One thing holds this up: ${blocked[0]!.label.toLowerCase()}.`
    : `${blocked.length} things hold this up, starting with ${blocked[0]!.label.toLowerCase()}.`
}
