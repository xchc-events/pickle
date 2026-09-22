import { BUILT_MODULES, MODULES, type ModuleKey } from './constants'
import { dateLabel, days, hrs, money } from './format'
import { costOf, monthKey } from './hours'
import type { Gate, LeadKey } from './event-record'
import {
  PARTS,
  bookingStep,
  nextMove,
  partsFor,
  type PartKey,
  type PartState,
  type PartsEvent,
} from './parts'
import { SOON_DAYS } from './pipeline'

/**
 * Home.
 *
 * Ported from `homeVals` in the design prototype
 * (docs/design-handoff/design/Pickle Prototype.dc.html, near line 3778), and
 * built on the parts of an event rather than the stages the prototype was
 * drawn against — see src/lib/parts.ts. Every gate on a part already says what
 * is wrong and which screen fixes it. "Needs you" is those gates, put in front
 * of the person they are waiting on.
 *
 * Nothing here decides whether a part is finished or what holds it up; the
 * parts decide. Home answers three questions they cannot:
 *
 *  - **Whose is it?** An event's own business — the booking, the licence,
 *    counting the night and putting it to bed — is its owner's. A
 *    department's part is its lead's. Where nobody is named who could act on
 *    it — no owner, an owner who never signs in, a lead whose role cannot open
 *    the screen — it goes to everyone who can open the module the part belongs
 *    to: Finance, for the event's own business, being where bookings are
 *    signed off and nights settled. Roster gaps and closing the bar are
 *    nobody's by name, and go to everyone who can open the roster or the bar,
 *    as the prototype had it.
 *  - **Is it today's?** However far off the night: a part that wants attention
 *    or is blocked, artwork up for sign-off, a booking still moving, a night
 *    still to settle. Anything else unfinished, once the booking is confirmed,
 *    when the night is inside the Pipeline's "Next 30 days" or a coordinator
 *    has flagged it. Beyond that it is the Pipeline's to show rather than a
 *    to-do. Once a night has passed its departments are history, and settling
 *    it is what is left. A booking that never reached confirmed is still asked
 *    about after its date: it is not a night that happened, and until the
 *    product can close an enquiry that came to nothing this is its only
 *    reminder.
 *  - **Which first?** Anything blocked outright, then whatever is due soonest:
 *    the night for most parts, the booking's own target for the booking.
 *
 * A reader is only ever shown a gate on a screen they can open. A part with no
 * such gate is left out rather than shown as a dead end.
 *
 * Pure over plain shapes, like the parts, so all of it is tested without a
 * database.
 */

// ------------------------------------------------------------------ input ---

/** One event, as Home reads it. Built by src/lib/home-data.ts. */
export interface HomeEvent {
  id: string
  name: string
  date: Date
  spaceName: string
  /** Display label: "Live music", "DJs". */
  format: string
  /** The owner's Person id. */
  ownerId: string | null
  /** The Person leading each department, where one is named. */
  leads: Partial<Record<LeadKey, string>>
  /** The coordinator's flag, as the Pipeline shows it. Null = not flagged. */
  riskNote: string | null
  input: PartsEvent
}

/** Who is reading. */
export interface Viewer {
  personId: string | null
  modules: readonly ModuleKey[]
}

/**
 * Everybody who could act on something: the person behind each active
 * account, and the modules that account's role opens.
 */
export type Actors = ReadonlyMap<string, readonly ModuleKey[]>

/**
 * The actors, from the accounts that could be one and what each role opens.
 *
 * Which accounts those are is the loader's query: active, and inside the
 * venue, since the event record refuses an outside account. An account with
 * nobody behind it cannot be anybody's lead or owner, so it is left out. A
 * role with no permission rows opens nothing.
 */
export function actorsOf(
  accounts: readonly { personId: string | null; role: string }[],
  modulesByRole: ReadonlyMap<string, readonly ModuleKey[]>,
): Actors {
  const actors = new Map<string, readonly ModuleKey[]>()
  for (const a of accounts) {
    if (a.personId) actors.set(a.personId, modulesByRole.get(a.role) ?? [])
  }
  return actors
}

// ---------------------------------------------------------------- screens ---

/**
 * The module a gate's screen belongs to. The event record is reached through
 * the Pipeline and gated on it, so a reader without the Pipeline cannot open it.
 */
const SCREEN_MODULE: Readonly<Record<string, ModuleKey>> = {
  event: 'pipeline',
  design: 'design',
  promo: 'promo',
  ticketing: 'ticketing',
  tech: 'tech',
  roster: 'roster',
  bar: 'bar',
  hours: 'hours',
}

const opens = (modules: readonly ModuleKey[], g: Gate): boolean => {
  const m = SCREEN_MODULE[g.screen]
  return m !== undefined && modules.includes(m)
}

/**
 * Where a gate is fixed. Module screens take the event they should open on,
 * so the fix lands on this night rather than whichever the module shows first.
 */
const fixHref = (screen: string, eventId: string): string =>
  screen === 'event' ? `/events/${eventId}` : `/${screen}?event=${eventId}`

/**
 * What each gate asks somebody to do, in the words of a to-do list. Keyed by
 * the gate's label, which src/lib/parts.test.ts pins; home.test.ts fails if a
 * gate is added without one.
 */
export const GATE_ACTION: Readonly<Record<string, string>> = {
  // booking
  'An owner is named': 'Name an owner',
  'Date is locked': 'Lock the date',
  'Space chosen': 'Choose the room',
  'Kind of night set': 'Set the kind of night',
  'Booking contact named': 'Name the booking contact',
  'At least one act confirmed': 'Confirm an act',
  'Fee floor and ceiling agreed': 'Agree the fee range',
  'Split agreed': 'Agree the split',
  'Terms agreed with the promoter': 'Agree terms with the promoter',
  'Bar close decided': 'Decide the bar close',
  // design
  'Design lead assigned': 'Find a design lead',
  'Artist bios and pics in': 'Chase bios and pics',
  'Both vertical cuts signed off': 'Sign off the vertical cuts',
  'Event cover signed off': 'Sign off the event cover',
  'Listing copy signed off': 'Sign off the listing copy',
  'Promoter signed off the creative': 'Chase the promoter’s sign-off',
  // promo
  'Promo lead assigned': 'Find a promo lead',
  'Every channel listed or ticked off': 'Get the listings out',
  'Nothing stale on a listing': 'Push the stale listings',
  'Announce and on-sale beats done': 'Work the promo plan',
  // tickets
  'Ticketing lead assigned': 'Find a ticketing lead',
  'Ticket tiers set': 'Price the tickets',
  'Booking confirmed': 'Confirm the booking',
  'Tickets live on Gather.rsvp': 'Put tickets on sale',
  // licence
  'Licence filed if it is needed': 'Apply for the special licence',
  'Special licence not denied': 'Licence denied',
  'Licence confirmed if needed': 'Get the licence confirmed',
  // tech
  'Tech lead assigned': 'Find a tech lead',
  'Tech plan confirmed': 'Confirm the tech plan',
  'Tech riders in': 'Chase tech riders',
  'Run times set': 'Set the run times',
  'Bar session set': 'Set the bar close',
  // roster
  'Every shift filled': 'Fill the open shifts',
  'Nothing left pencilled': 'Confirm pencilled crew',
  // settlement
  'Hours logged for this event': 'Log the hours',
  'Actuals in': 'Count the night',
}

// ------------------------------------------------------------------ whose ---

type Whose =
  /** The event's owner — or, with nobody named who could act, whoever can open Finance. */
  | { kind: 'owner' }
  /** The department's lead — or, with nobody named who could act, its module. */
  | { kind: 'lead'; lead: LeadKey; module: ModuleKey }
  /** Nobody by name: everyone who can open the module. */
  | { kind: 'anyone'; module: ModuleKey }

const OWNER_FALLBACK: ModuleKey = 'finance'

const WHOSE: Readonly<Record<PartKey, Whose>> = {
  booking: { kind: 'owner' },
  design: { kind: 'lead', lead: 'design', module: 'design' },
  promo: { kind: 'lead', lead: 'promo', module: 'promo' },
  tickets: { kind: 'lead', lead: 'ticketing', module: 'ticketing' },
  licence: { kind: 'owner' },
  tech: { kind: 'lead', lead: 'tech', module: 'tech' },
  roster: { kind: 'anyone', module: 'roster' },
  // The bar half of the night is overridden where it is asked for.
  settlement: { kind: 'owner' },
}

export type Claim = 'yours' | 'unclaimed' | null

/** Whether this reader is asked about it, and on what claim; undefined when not. */
function claimOf(
  whose: Whose,
  e: HomeEvent,
  gates: Gate[],
  viewer: Viewer,
  actors: Actors,
): Claim | undefined {
  if (whose.kind === 'anyone') return viewer.modules.includes(whose.module) ? null : undefined

  const named = whose.kind === 'owner' ? e.ownerId : (e.leads[whose.lead] ?? null)
  const namedCanAct = named !== null && gates.some((g) => opens(actors.get(named) ?? [], g))
  if (namedCanAct) return viewer.personId === named ? 'yours' : undefined

  const fallback = whose.kind === 'owner' ? OWNER_FALLBACK : whose.module
  return viewer.modules.includes(fallback) ? 'unclaimed' : undefined
}

// ------------------------------------------------------------------ today ---

/** The pieces of the set somebody has put up for sign-off. */
const inReview = (i: PartsEvent) => i.assets.filter((a) => a.state === 'review').length

function isToday(e: HomeEvent, p: PartState): boolean {
  const i = e.input
  if (i.concluded || !p.applies) return false
  // A night's settlement only applies once the night has come.
  if (p.key === 'settlement') return !p.done
  // Bookings move by hand, on their own clock — and keep asking after the
  // date has gone, since an unconfirmed booking is not a night that happened.
  if (p.key === 'booking') return !p.done
  // Once the night has passed, its departments are history.
  if (i.daysToDoor < 0) return false
  // Somebody asked for a decision. The story and the poster hold up no gate,
  // so this is asked whether or not the part reads finished.
  if (p.key === 'design' && inReview(i) > 0) return true
  if (p.done) return false
  if (p.tone === 'stop' || p.tone === 'warn') return true
  // A night that may not happen is not one to do the work for yet.
  if (i.booking !== 'confirmed') return false
  return i.daysToDoor <= SOON_DAYS || e.riskNote !== null
}

// ------------------------------------------------------------------- when ---

interface Clock {
  due: number
  when: string
}

const doorClock = (d: number): Clock => ({
  due: d,
  when: d > 0 ? `${d}d out` : d === 0 ? 'tonight' : `${-d}d ago`,
})

/** A booking is due by its own target, or by the door if that comes first. */
function bookingClock(i: PartsEvent): Clock {
  const target = bookingStep(i.booking).target
  if (target === null) return doorClock(i.daysToDoor)

  const left = target - i.bookingDays
  if (i.daysToDoor < left) return doorClock(i.daysToDoor)
  return {
    due: left,
    when: left < 0 ? `${-left}d over` : left === 0 ? 'due today' : `${left}d left`,
  }
}

// ------------------------------------------------------------------ needs ---

export type NeedTone = 'stop' | 'warn' | 'plain'

export interface Need {
  /** Unique across the list. */
  key: string
  eventId: string
  part: PartKey
  icon: string
  tone: NeedTone
  /** "Fill 3 shifts — Static Bloom". */
  title: string
  sub: string
  /** "8d out", "tonight", "2d ago", "2d over", "1d left". */
  when: string
  /** Days until it is due, negative once it is overdue. The list sorts by it. */
  due: number
  href: string
  /**
   * 'yours' when it is the reader's by name, 'unclaimed' when it reached them
   * because nobody named could act on it, null where nobody is ever named.
   */
  claim: Claim
}

/** One thing a part asks, before it is known who is reading. */
interface Draft {
  kind: string
  part: PartState
  whose: Whose
  /** The gates it is about, the one to lead with first. */
  gates: Gate[]
  clock: Clock
  title?: string
  /** Replaces the lead gate's reason, and the count of what else is open. */
  sub?: string
  icon?: string
}

/** Stands in for a gate where the ask is a move, not a failing condition. */
const moveGate = (why: string): Gate => ({ label: 'move', ok: false, why, screen: 'event' })

const toFront = (gates: Gate[], label: string): Gate[] => [
  ...gates.filter((g) => g.label === label),
  ...gates.filter((g) => g.label !== label),
]

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

function draftsFor(e: HomeEvent, p: PartState): Draft[] {
  const i = e.input
  const failing = p.checks.filter((g) => !g.ok)
  const base = { part: p, whose: WHOSE[p.key], clock: doorClock(i.daysToDoor) }

  switch (p.key) {
    case 'booking': {
      const clock = bookingClock(i)
      const move = nextMove(i)
      if (failing.length === 0 && move) {
        const gates = [moveGate(move.message)]
        return [
          { ...base, clock, kind: 'booking-move', gates, title: move.label, sub: move.message },
        ]
      }
      if (i.dealState === 'queried') {
        const gates = toFront(failing, 'Terms agreed with the promoter')
        return [{ ...base, clock, kind: 'booking', gates, title: 'Answer their query' }]
      }
      return [{ ...base, clock, kind: 'booking', gates: failing }]
    }

    case 'design': {
      const review = inReview(i)
      if (review > 0) {
        const sub = `${review} ${plural(review, 'piece', 'pieces')} waiting for sign-off`
        const gates: Gate[] = [{ label: 'review', ok: false, why: sub, screen: 'design' }]
        return [{ ...base, kind: 'review', gates, title: 'Approve artwork', sub }]
      }
      // Waiting on the promoter is what makes the part ask; lead with it.
      const gates =
        p.tone === 'warn' ? toFront(failing, 'Promoter signed off the creative') : failing
      return [{ ...base, kind: 'design', gates }]
    }

    case 'promo': {
      const stale = i.channels.filter((c) => c.stale).length
      if (stale > 0) {
        return [
          {
            ...base,
            kind: 'promo',
            gates: toFront(failing, 'Nothing stale on a listing'),
            title: `${stale} ${plural(stale, 'listing', 'listings')} stale`,
            sub: 'Changed since it went out',
            icon: 'ph-upload-simple',
          },
        ]
      }
      return [{ ...base, kind: 'promo', gates: failing }]
    }

    case 'tickets':
      // Confirming the booking is the booking's ask, not ticketing's.
      return [
        { ...base, kind: 'tickets', gates: failing.filter((g) => g.label !== 'Booking confirmed') },
      ]

    case 'licence': {
      const title =
        i.licence === 'denied'
          ? 'Licence denied'
          : i.licence === 'applied_for'
            ? 'Chase the licence'
            : 'Apply for the special licence'
      // The three licence gates are one state read three ways — a denied
      // licence is also an unconfirmed one — so the first reason is the whole
      // of it, not one of several things to do.
      const sub = failing[0]?.why
      return [{ ...base, kind: 'licence', gates: failing, title, sub }]
    }

    case 'tech':
      return [{ ...base, kind: 'tech', gates: failing }]

    case 'roster': {
      const total = i.shifts.length
      const open = i.shifts.filter((s) => !s.assigned).length
      if (open > 0) {
        return [
          {
            ...base,
            kind: 'roster',
            gates: failing,
            title: `Fill ${open} ${plural(open, 'shift', 'shifts')}`,
            sub: `${total - open} of ${total} filled`,
          },
        ]
      }
      return [{ ...base, kind: 'roster', gates: failing }]
    }

    case 'settlement': {
      const drafts: Draft[] = []
      // The night is reconciled in two halves, each where it is entered — see
      // src/lib/actuals.ts. The bar's is whoever runs the bar's.
      if (!i.barClosed) {
        drafts.push({
          ...base,
          kind: 'bar',
          whose: { kind: 'anyone', module: 'bar' },
          gates: [
            { label: 'Actuals in', ok: false, why: 'Bar take not reconciled', screen: 'bar' },
          ],
          title: 'Close the bar',
          icon: 'ph-beer-bottle',
        })
      }
      if (!i.doorCounted) {
        drafts.push({
          ...base,
          kind: 'door',
          gates: [
            {
              label: 'Actuals in',
              ok: false,
              why: 'Final ticket count not reconciled',
              screen: 'event',
            },
          ],
          title: 'Count the door',
        })
      }
      const rest = failing.filter((g) => g.label !== 'Actuals in')
      if (rest.length > 0) drafts.push({ ...base, kind: 'hours', gates: rest })

      const move = nextMove(i)
      if (failing.length === 0 && move) {
        drafts.push({
          ...base,
          kind: 'settle',
          gates: [moveGate(move.message)],
          title: move.label,
          sub: move.message,
        })
      }
      return drafts
    }
  }
}

/** The one line the event record words for its own page. */
function reasonOf(g: Gate, i: PartsEvent): string {
  if (g.label === 'Terms agreed with the promoter' && i.dealState === 'sent' && !i.hasPortal) {
    return 'Record it on the event record once they say yes'
  }
  return g.why
}

const PART_INDEX = new Map(PARTS.map((p, n) => [p.key, n]))

/** Everything waiting on this reader, most pressing first. */
export function needsFor(events: HomeEvent[], viewer: Viewer, actors: Actors): Need[] {
  const needs: Need[] = []

  for (const e of events) {
    for (const p of partsFor(e.input)) {
      if (!isToday(e, p)) continue

      for (const d of draftsFor(e, p)) {
        const claim = claimOf(d.whose, e, d.gates, viewer, actors)
        if (claim === undefined) continue

        const readable = d.gates.filter((g) => opens(viewer.modules, g))
        const head = readable[0]
        if (!head) continue

        const more = readable.length - 1
        const tone: NeedTone = p.tone === 'stop' || p.tone === 'warn' ? p.tone : 'plain'

        needs.push({
          key: `${e.id}:${d.kind}`,
          eventId: e.id,
          part: p.key,
          icon: d.icon ?? p.icon,
          tone,
          title: `${d.title ?? GATE_ACTION[head.label] ?? head.label} — ${e.name}`,
          sub: d.sub ?? `${reasonOf(head, e.input)}${more > 0 ? ` · ${more} more` : ''}`,
          when: d.clock.when,
          due: d.clock.due,
          href: fixHref(head.screen, e.id),
          claim,
        })
      }
    }
  }

  const blocked = (n: Need) => (n.tone === 'stop' ? 0 : 1)
  return needs.sort(
    (a, b) =>
      blocked(a) - blocked(b) ||
      a.due - b.due ||
      a.eventId.localeCompare(b.eventId) ||
      (PART_INDEX.get(a.part) ?? 0) - (PART_INDEX.get(b.part) ?? 0),
  )
}

export interface SplitNeeds {
  /** Named to the reader, or a queue addressed to anyone who can open the module. */
  yours: Need[]
  /** Reached this reader only because nobody named could act on it — everyone's to notice. */
  unclaimed: Need[]
}

/**
 * "Needs you" from "nobody's on it". Connor: "if there's a super admin with
 * zero of their own events, I don't see why it would be saying that these
 * things need to be done by me" — a claim of `null` is still a queue
 * addressed to anyone who can open the module (fill a shift, close a bar),
 * and stays theirs to be asked about; only `'unclaimed'` — the fallback for
 * an event's own business with nobody reachable to own it — moves out.
 * Order within each half is kept as `needsFor` sorted it.
 */
export function splitNeeds(needs: Need[]): SplitNeeds {
  return {
    yours: needs.filter((n) => n.claim !== 'unclaimed'),
    unclaimed: needs.filter((n) => n.claim === 'unclaimed'),
  }
}

export const needsCount = (total: number): string => (total > 0 ? `${total} open` : 'clear')

/** The line under the greeting. */
export function homeSub(total: number, live: number): string {
  const pipeline = `${live} ${plural(live, 'event', 'events')} in the pipeline`
  if (total === 0) return `${pipeline} · nothing blocking`
  return `${total} ${plural(total, 'thing wants', 'things want')} you today · ${pipeline}`
}

export function greeting(name: string): string {
  const first = name.trim().split(/\s+/)[0]
  return first ? `Kia ora, ${first}.` : 'Kia ora.'
}

// ------------------------------------------------------------------ tiles ---

export type TileTone = 'plain' | 'good' | 'warn'

export interface Tile {
  label: string
  value: string
  sub: string
  tone: TileTone
  href: string | null
}

/**
 * A night inside the Revenue tile's actual-revenue window, both halves
 * counted. `taken` is ex-GST income — ticket sales ex GST plus bar profit,
 * the same basis `financeVals` uses for `income` — see `takenOf` in
 * src/lib/actuals.ts. A night with a half still missing never becomes one of
 * these; home-data.ts leaves it out rather than passing a null.
 */
export interface CountedNight {
  /** Whole calendar days before now the door was. Never negative. */
  daysAgo: number
  taken: number
}

/**
 * How many days the Revenue tile's actual and projected halves each span:
 * the last 4 weeks counted, the next 4 weeks modelled. One number, so the two
 * halves of the tile cannot disagree about how wide "4 weeks" is.
 */
export const REVENUE_DAYS = 28

/**
 * Whether a night counts toward the Revenue tile's projected figure: live,
 * booking confirmed — a night still being negotiated is not one to bank on —
 * with its door inside the next four weeks, and not already fully counted.
 * A night whose door and bar are both in is already in the actual figure;
 * counting it here too would double it on its own day. A half-counted night
 * stays in, since the other half is still a projection. home-data.ts sums
 * `financeVals(...).income` over exactly the nights this returns true for,
 * the same way it already works out the next night's surplus.
 */
export function inRevenueWindow(e: HomeEvent): boolean {
  const days = e.input.daysToDoor
  return (
    !e.input.concluded &&
    e.input.booking === 'confirmed' &&
    days >= 0 &&
    days < REVENUE_DAYS &&
    !(e.input.doorCounted && e.input.barClosed)
  )
}

/** How many of these nights have a confirmed booking, as a tile's sub-line. */
const confirmedOf = (events: HomeEvent[]): string =>
  `${events.filter((e) => e.input.booking === 'confirmed').length} confirmed`

/**
 * The strip under the greeting. Each tile reads one module's records and is
 * shown only to someone who can open that module — the Pipeline's four first,
 * as the prototype had them; the roster's and the bar's for those who cannot
 * open the Pipeline.
 *
 * @param projected The next four weeks' modelled income over confirmed
 *   nights — `financeVals(...).income` summed over `inRevenueWindow`, the way
 *   home-data.ts already works out the next night's surplus. Read only by a
 *   viewer who can also open Finance; pass 0 when nobody will read it.
 */
export function homeTiles(
  events: HomeEvent[],
  counted: CountedNight[],
  projected: number,
  viewer: Viewer,
): Tile[] {
  const can = (m: ModuleKey) => viewer.modules.includes(m)
  const live = events.filter((e) => !e.input.concluded)
  const tiles: Tile[] = []

  if (can('pipeline')) {
    const flagged = live.filter((e) => e.riskNote !== null).length
    // Counts exactly what /pipeline?status=soon lists — pipelineRows' own
    // "Next 30 days" filter (see SOON_DAYS), day 30 and unconcluded nights
    // whose door has already passed included, since that filter has no floor.
    const soon = live.filter((e) => e.input.daysToDoor <= SOON_DAYS)

    let fourth: Tile
    if (can('finance')) {
      // "Income, as settlements count it" (Connor, 22 Sep 2026): ticket sales
      // ex GST plus bar profit, the same figure financeVals calls income — so
      // the actual and the projected halves of this tile cannot disagree.
      const actual = counted
        .filter((c) => c.daysAgo >= 0 && c.daysAgo < REVENUE_DAYS)
        .reduce((n, c) => n + c.taken, 0)
      fourth = {
        label: 'Revenue',
        value: money(actual),
        sub: `last 4 weeks · ${money(projected)} projected, next 4`,
        tone: 'good',
        href: null,
      }
    } else {
      // Gather.rsvp stays live after the night; the night is no longer selling.
      const onSale = live.filter((e) => e.input.ticketsLive && e.input.daysToDoor >= 0)
      const sold = onSale.reduce((n, e) => n + e.input.sold, 0)
      fourth = {
        label: 'On sale',
        value: String(onSale.length),
        sub: `${sold} ${plural(sold, 'ticket', 'tickets')} sold`,
        tone: 'plain',
        href: can('ticketing') ? '/ticketing' : null,
      }
    }

    tiles.push(
      {
        label: 'In the pipeline',
        value: String(live.length),
        sub: confirmedOf(live),
        tone: 'plain',
        href: '/pipeline',
      },
      {
        label: 'Next 30 days',
        value: String(soon.length),
        sub: confirmedOf(soon),
        tone: 'plain',
        href: '/pipeline?status=soon',
      },
      {
        // The Pipeline's own "At risk": a coordinator's flag, in their words.
        label: 'At risk',
        value: String(flagged),
        sub: 'flagged on the pipeline',
        tone: flagged > 0 ? 'warn' : 'good',
        href: '/pipeline?status=risk',
      },
      fourth,
    )
  }

  if (can('roster')) {
    // The nights Roster queues: every live one, confirmed or not, since the
    // venue decided (16 Sep 2026) that crew need not wait for the booking. The
    // tile links there, so it counts what that screen shows. A past night is
    // history.
    const gaps = live
      .filter((e) => e.input.daysToDoor >= 0)
      .map((e) => e.input.shifts.filter((s) => !s.assigned).length)
    const open = gaps.reduce((n, g) => n + g, 0)
    const nights = gaps.filter((g) => g > 0).length

    tiles.push({
      label: 'Shifts to fill',
      value: String(open),
      sub:
        open > 0 ? `across ${nights} ${plural(nights, 'night', 'nights')}` : 'every shift filled',
      tone: open > 0 ? 'warn' : 'good',
      href: '/roster',
    })
  }

  if (can('bar')) {
    // The same nights the settlement asks to be closed: confirmed, and come.
    const toClose = live
      .filter(
        (e) => e.input.booking === 'confirmed' && e.input.daysToDoor <= 0 && !e.input.barClosed,
      )
      .sort((a, b) => a.input.daysToDoor - b.input.daysToDoor)
    const oldest = toClose[0]

    tiles.push({
      label: 'Bars to close',
      value: String(toClose.length),
      sub: !oldest
        ? 'every night closed'
        : oldest.input.daysToDoor === 0
          ? 'tonight'
          : `oldest ${days(-oldest.input.daysToDoor)} ago`,
      tone: oldest ? 'warn' : 'good',
      href: oldest ? `/bar?event=${oldest.id}` : '/bar',
    })
  }

  return tiles.slice(0, 4)
}

// -------------------------------------------------- next upcoming events ---

/** The soonest nights still to come that are actually happening, soonest first. */
export function pickNext(events: HomeEvent[], count: number): HomeEvent[] {
  const ahead = events.filter(
    (e) => !e.input.concluded && e.input.booking === 'confirmed' && e.input.daysToDoor >= 0,
  )
  return ahead.sort((a, b) => a.input.daysToDoor - b.input.daysToDoor).slice(0, count)
}

export interface NextNight {
  id: string
  name: string
  /** "Fri 25 Sep · Main · DJs". */
  when: string
  /** The big figure: "8", or "Tonight". */
  days: string
  daysLabel: string
  line: string
  href: string | null
  cta: string | null
}

/** The first way into a night this reader has, in the order most useful. */
const WAYS_IN: readonly { module: ModuleKey; href: (id: string) => string; cta: string }[] = [
  { module: 'pipeline', href: (id) => `/events/${id}`, cta: 'Open the event' },
  { module: 'bar', href: (id) => `/bar?event=${id}`, cta: 'Open in Bar' },
  { module: 'roster', href: (id) => `/roster?event=${id}`, cta: 'Open the roster' },
  { module: 'tech', href: (id) => `/tech?event=${id}`, cta: 'Open in Tech' },
]

function toFinish(parts: PartState[]): string {
  // Settling comes after the night, not before it.
  const left = parts.filter((p) => p.applies && !p.done && p.key !== 'settlement')
  const [a, b] = left
  if (!a) return 'every part done'
  if (!b) return `${a.label} to finish`
  if (left.length === 2) return `${a.label} and ${b.label} to finish`
  return `${left.length} parts to finish`
}

/**
 * The card. Where each part stands and what the night is projected to leave
 * are the event record's to show, so a reader who cannot open it gets the
 * night without them.
 *
 * @param surplus The event record's own "surplus to split", or null.
 */
export function nextNight(e: HomeEvent, viewer: Viewer, surplus: number | null): NextNight {
  const i = e.input
  const record = viewer.modules.includes('pipeline')

  const bits: string[] = []
  if (i.doors) bits.push(`Doors ${i.doors}`)
  bits.push(i.capacity > 0 ? `${i.sold} sold of ${i.capacity}` : `${i.sold} sold`)
  if (record) {
    bits.push(toFinish(partsFor(i)))
    if (surplus !== null) bits.push(`surplus to split ${money(surplus)}`)
  }

  const way = WAYS_IN.find((w) => viewer.modules.includes(w.module))

  return {
    id: e.id,
    name: e.name,
    when: `${dateLabel(e.date)} · ${e.spaceName} · ${e.format}`,
    days: i.daysToDoor === 0 ? 'Tonight' : String(i.daysToDoor),
    daysLabel: i.daysToDoor === 0 ? '' : plural(i.daysToDoor, 'day away', 'days away'),
    line: bits.join(' · '),
    href: way ? way.href(e.id) : null,
    cta: way ? way.cta : null,
  }
}

// ------------------------------------------------------------- your hours ---

export interface MyHoursInput {
  now: Date
  /** What the person said they can do each week, or null if they have not. */
  availability: { weekly: number; volunteer: number } | null
  /** `rostered` is an hour a shift wrote, the only kind that can be still to come. */
  entries: { hours: number; workedOn: Date; rostered: boolean }[]
}

export interface MyHours {
  total: string
  /** At the loaded rate, as every hour is costed. */
  cost: string
  /** "4.5h still to come" when some is ahead, "nothing logged yet" for zero, else "". */
  split: string
  /** 0–100 against what they're available for this month, or null with nothing to measure against. */
  pct: number | null
  capLabel: string | null
}

/**
 * This calendar month's hours, by the day the work happened — an hour typed
 * up a fortnight late is still the month it was worked in, as Hours has it.
 *
 * A rostered shift's hours are written the moment somebody is put on it, dated
 * the night itself (`assignShift`), so the month already holds the ones still
 * to come. Only those can be: an hour somebody typed is work done, whatever
 * day it is filed under. Org-wide hours are filed under the 15th of their
 * month, and would otherwise read as still to come until the 15th.
 */
export function myHours({ now, availability, entries }: MyHoursInput): MyHours {
  const month = monthKey(now)
  const mine = entries.filter((x) => monthKey(x.workedOn) === month)
  const sum = (rows: typeof mine) => rows.reduce((n, x) => n + x.hours, 0)

  const toCome = (x: (typeof mine)[number]) => x.rostered && x.workedOn.getTime() > now.getTime()
  const ahead = sum(mine.filter(toCome))
  const worked = sum(mine.filter((x) => !toCome(x)))
  const total = worked + ahead

  // A week's cap spread over this month's days, volunteer hours on top as the
  // roster counts them.
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const ceiling = availability
    ? ((availability.weekly + availability.volunteer) * daysInMonth) / 7
    : 0

  // The total is already the headline figure above; this line only ever adds
  // to it — what's still ahead — or says there is nothing logged yet. A
  // month that is all worked and nothing ahead has nothing left to add.
  const split = ahead > 0 ? `${hrs(ahead)} still to come` : total > 0 ? '' : 'nothing logged yet'

  return {
    total: hrs(total),
    cost: money(costOf(total)),
    split,
    pct: ceiling > 0 ? Math.min(100, Math.round((total / ceiling) * 100)) : null,
    capLabel: ceiling > 0 ? `of the ~${Math.round(ceiling)}h you’re available this month` : null,
  }
}

// ----------------------------------------------------------------- access ---

/**
 * Whether this user may open Home.
 *
 * Home is the venue's own to-do list: whose licence is late, whose shifts are
 * open, what the last two nights took. An outside promoter's equivalent is
 * Sign-offs, so an outside account is refused outright, whatever the
 * permission matrix says — the same call as Bar.
 */
export function homeRefusal(user: { external: boolean }): string | null {
  return user.external
    ? 'Home is the venue’s own to-do list. An outside account’s is Sign-offs.'
    : null
}

/**
 * Where a signed-in user lands: the first built module their role reaches, in
 * sidebar order — Home for anyone inside the venue, since it is first. An
 * outside account is never landed on Home, which would refuse them.
 */
export function landingFor(modules: readonly ModuleKey[], external: boolean): string | null {
  const first = MODULES.find(
    (m) =>
      modules.includes(m.key) && BUILT_MODULES.includes(m.key) && !(external && m.key === 'home'),
  )
  return first ? `/${first.key}` : null
}
