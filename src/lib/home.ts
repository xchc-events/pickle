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
 *    to-do — and once a night has passed, settling it is all that is left.
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

const CTA: Readonly<Record<string, string>> = {
  event: 'Open the event',
  design: 'Open design',
  promo: 'Open promotion',
  ticketing: 'Open ticketing',
  tech: 'Open tech',
  roster: 'Open roster',
  bar: 'Open the bar',
  hours: 'Log hours',
}

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
  // Bookings move by hand, on their own clock.
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
  cta: string
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
  cta?: string
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
            cta: 'Push',
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
          cta: d.cta ?? CTA[head.screen] ?? 'Open',
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

/** How many rows the list shows. The rest are counted, not dropped. */
export const NEEDS_SHOWN = 6

export function shownNeeds(needs: Need[]): { shown: Need[]; more: number } {
  return {
    shown: needs.slice(0, NEEDS_SHOWN),
    more: Math.max(0, needs.length - NEEDS_SHOWN),
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

/** A night with both halves counted, and what it took: tickets plus bar profit. */
export interface CountedNight {
  date: Date
  taken: number
}

/**
 * The strip under the greeting. Each tile reads one module's records and is
 * shown only to someone who can open that module — the Pipeline's four first,
 * as the prototype had them; the roster's and the bar's for those who cannot
 * open the Pipeline.
 */
export function homeTiles(events: HomeEvent[], counted: CountedNight[], viewer: Viewer): Tile[] {
  const can = (m: ModuleKey) => viewer.modules.includes(m)
  const live = events.filter((e) => !e.input.concluded)
  const tiles: Tile[] = []

  if (can('pipeline')) {
    const mine = live.filter((e) => viewer.personId !== null && e.ownerId === viewer.personId)
    const flagged = live.filter((e) => e.riskNote !== null).length
    // Gather.rsvp stays live after the night; the night is no longer selling.
    const onSale = live.filter((e) => e.input.ticketsLive && e.input.daysToDoor >= 0)
    const sold = onSale.reduce((n, e) => n + e.input.sold, 0)
    const recent = [...counted].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 2)

    tiles.push(
      {
        label: 'In the pipeline',
        value: String(live.length),
        sub: `${mine.length} yours`,
        tone: 'plain',
        href: '/pipeline',
      },
      {
        // The Pipeline's own "At risk": a coordinator's flag, in their words.
        label: 'At risk',
        value: String(flagged),
        sub: 'flagged on the pipeline',
        tone: flagged > 0 ? 'warn' : 'good',
        href: '/pipeline?status=risk',
      },
      {
        label: 'On sale',
        value: String(onSale.length),
        sub: `${sold} ${plural(sold, 'ticket', 'tickets')} sold`,
        tone: 'plain',
        href: can('ticketing') ? '/ticketing' : null,
      },
      recent.length === 0
        ? {
            label: 'Revenue, last 2 events',
            value: '—',
            sub: 'no night counted yet',
            tone: 'plain',
            href: null,
          }
        : {
            label: recent.length === 1 ? 'Revenue, last event' : 'Revenue, last 2 events',
            value: money(recent.reduce((n, c) => n + c.taken, 0)),
            sub: 'tickets + bar profit, actual',
            tone: 'good',
            href: null,
          },
    )
  }

  if (can('roster')) {
    // A night not yet confirmed is not rostered for, and a past one is history.
    const gaps = live
      .filter((e) => e.input.booking === 'confirmed' && e.input.daysToDoor >= 0)
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

// ------------------------------------------------- next through the door ---

/** The soonest night still to come that is actually happening. */
export function pickNext(events: HomeEvent[]): HomeEvent | null {
  const ahead = events.filter(
    (e) => !e.input.concluded && e.input.booking === 'confirmed' && e.input.daysToDoor >= 0,
  )
  return ahead.sort((a, b) => a.input.daysToDoor - b.input.daysToDoor)[0] ?? null
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
  entries: { hours: number; workedOn: Date }[]
}

export interface MyHours {
  total: string
  /** At the loaded rate, as every hour is costed. */
  cost: string
  /** "8h worked · 4.5h still to come". */
  split: string
  /** 0–100 against what they can do this month, or null with nothing to measure against. */
  pct: number | null
  capLabel: string | null
}

/**
 * This calendar month's hours, by the day the work happened — an hour typed
 * up a fortnight late is still the month it was worked in, as Hours has it.
 * Rostered shifts are written the moment somebody is put on them, so the month
 * already holds the ones still to come.
 */
export function myHours({ now, availability, entries }: MyHoursInput): MyHours {
  const month = monthKey(now)
  const mine = entries.filter((x) => monthKey(x.workedOn) === month)
  const sum = (rows: typeof mine) => rows.reduce((n, x) => n + x.hours, 0)

  const worked = sum(mine.filter((x) => x.workedOn.getTime() <= now.getTime()))
  const ahead = sum(mine.filter((x) => x.workedOn.getTime() > now.getTime()))
  const total = worked + ahead

  // A week's cap spread over this month's days, volunteer hours on top as the
  // roster counts them.
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const ceiling = availability
    ? ((availability.weekly + availability.volunteer) * daysInMonth) / 7
    : 0

  const split = [
    worked > 0 ? `${hrs(worked)} worked` : null,
    ahead > 0 ? `${hrs(ahead)} still to come` : null,
  ]
    .filter((s) => s !== null)
    .join(' · ')

  return {
    total: hrs(total),
    cost: money(costOf(total)),
    split: split || 'nothing logged yet',
    pct: ceiling > 0 ? Math.min(100, Math.round((total / ceiling) * 100)) : null,
    capLabel: ceiling > 0 ? `of about ${Math.round(ceiling)}h you can do this month` : null,
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
