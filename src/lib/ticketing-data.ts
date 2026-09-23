import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { dateLabel, money, timeLabel } from './format'
import { financeVals } from './finance'
import { financeInputFor, orgShareFor, scenarioOf } from './finance-input'
import {
  capacityOf,
  mixProblem,
  normaliseMix,
  paceOf,
  sellThrough,
  tierTable,
  type MixKey,
} from './ticketing'
import { readSales, salesHistory } from './gather'
import { earliestSaleDay } from './sales-chart'
import { bookingStep, type BookingStatus } from './parts'
import type { SessionUser } from './session'
import {
  compsCountFor,
  groupDoorList,
  totalPeople,
  type DoorListGroup,
  type DoorListRow,
} from './door-list'
import { CODE_STATE_LABELS, codeState, codeValueLabel, type TicketCodeState } from './ticket-codes'

/**
 * Loads Ticketing.
 *
 * Every figure that involves money comes from `financeVals` in finance.ts,
 * which is specification. This file assembles what it needs and presents the
 * result — it does not do arithmetic on prices of its own, because the number
 * shown on this page and the number on the settlement have to be the same
 * number rather than two that agree today.
 */

export interface TicketTier {
  key: string
  label: string
  price: string
  share: string
  /** What this tier contributes to the average, at its share. */
  contributes: string
}

export interface TicketQueueRow {
  id: string
  name: string
  date: string
  sold: number
  capacity: number
  pct: number
  note: string
  tone: 'good' | 'warn' | 'stop' | 'plain'
  onSale: boolean
}

/** One tier's ticket sales on one day — not a running total. Feeds the chart. */
export interface TicketSalePoint {
  day: Date
  tier: MixKey
  sold: number
}

export interface TicketEvent {
  id: string
  name: string
  date: string
  spaceName: string
  format: string
  /** "Negotiating", "Confirmed". Tickets wait for the second. */
  bookingLabel: string
  confirmed: boolean
  onSale: boolean

  std: number
  door: number
  mix: number[]
  sold: number
  /** "Tue 22 Sep, 4:10 pm" — when Gather.rsvp last confirmed `sold`. */
  soldAsOf: string
  capacity: number

  tiers: TicketTier[]
  /** Null when the mix is sound. */
  mixProblem: string | null
  average: string

  breakeven: number
  fullPay: number

  /** Daily sales by tier, for the sales-over-time chart. Empty means nothing has sold yet. */
  salesHistory: TicketSalePoint[]
  /** When tickets went live on Gather — the Gather channel push's time, else the first sale. */
  onSaleAt: Date
  /** The moment this page was loaded — the chart's "today", and where its projection starts. */
  today: Date
  /** The event's own night — "the door" the projection runs to. */
  doorAt: Date
  /** `paceOf(...).projected` — read here, not reworked; the chart only places it. */
  projectedTotal: number

  /**
   * Ticket revenue so far: `sold` at the average ticket price. GST inclusive
   * — the same basis as the prices on the event record — which is *not* what
   * the settlement counts; `financeVals.ticketsEx` divides by GST once for
   * that. Shown for "how much has this made", not reconciled against the P&L.
   */
  revenue: string

  /** T6 — the list with state, newest first. */
  codes: TicketCodeRow[]
  /** T7 — grouped by kind, with the section's own running total. */
  doorList: DoorListSection
}

/** One code, as the Codes section shows it — T6. */
export interface TicketCodeRow {
  id: string
  code: string
  kind: string
  /** "10% off", "$5 off", "Free ticket", "Unlocks sup" — `codeValueLabel`. */
  valueLabel: string
  tierKey: string | null
  useLimit: number | null
  uses: number
  state: TicketCodeState
  stateLabel: string
  who: string
  whenLabel: string
}

/** The door list, grouped and totalled — T7. */
export interface DoorListSection {
  groups: DoorListGroup[]
  totalPeople: number
  /**
   * Whether the comps P&L line is currently reading this list rather than
   * the event record's typed crew figure — see `compsCountFor` in
   * src/lib/door-list.ts, and the note the section shows underneath it.
   */
  compsFromList: boolean
}

export interface TicketingLoad {
  queue: TicketQueueRow[]
  event: TicketEvent | null
}

const EVENT_INCLUDE = {
  space: { select: { name: true, capacity: true, seatedCapacity: true } },
  artists: { select: { low: true, high: true, status: true } },
  // `person.employment` is what `financeInputFor` blends the wage cost from.
  shifts: { select: { hours: true, personId: true, person: { select: { employment: true } } } },
  tasks: { select: { est: true, actual: true } },
  addons: { select: { kind: true, cost: true, hours: true } },
  // `at` is when the gather push went live — the chart's on-sale date.
  channels: { where: { channel: 'gather' }, select: { live: true, at: true } },
} as const

export async function loadTicketing(
  user: SessionUser,
  wantedId: string | undefined,
): Promise<TicketingLoad> {
  // Every live event, from the enquiry on. This used to start at Confirmed so
  // nobody priced a show that may not happen, but the terms a booking is
  // confirmed on are worked out from its ticket price — so the price has to
  // be settable while they are. What waits for confirmation is going on sale,
  // and that is refused where Gather.rsvp is pushed rather than hidden here.
  const rows = await db.event.findMany({
    where: { AND: [{ concluded: false }, eventScope(user)] },
    orderBy: { date: 'asc' },
    include: EVENT_INCLUDE,
    take: 30,
  })

  const queue: TicketQueueRow[] = rows.map((e) => {
    const capacity = capacityOf(e.space, e.format)
    const pct = sellThrough(e.sold, capacity)
    // Gather.rsvp is the source of truth; EVENT_INCLUDE reads only its row.
    const onSale = e.channels.some((c) => c.live)
    const confirmed = e.bookingStatus === 'CONFIRMED'

    return {
      id: e.id,
      name: e.name,
      date: dateLabel(e.date),
      sold: e.sold,
      capacity,
      pct,
      onSale,
      note: onSale ? `${e.sold} of ${capacity}` : confirmed ? 'not on sale yet' : 'unconfirmed',
      tone: onSale
        ? pct >= 70
          ? 'good'
          : pct > 0
            ? 'plain'
            : 'stop'
        : confirmed
          ? 'warn'
          : 'plain',
    }
  })

  const ids = rows.map((e) => e.id)
  const chosen = wantedId && ids.includes(wantedId) ? wantedId : (ids[0] ?? null)
  if (!chosen) return { queue, event: null }

  const row = rows.find((e) => e.id === chosen)!

  // Org-wide labour apportioned to this event's month, the same input every
  // other projection uses. See src/lib/finance-input.ts.
  const orgShareHours = await orgShareFor(row.date)

  // The door list's own COMP entries, party sizes summed, stand in for the
  // typed crew figure once any exist for this event — `compsCountFor` in
  // src/lib/door-list.ts. `financeInputFor` still reads everything else off
  // `row`; only the one field is overridden, the same way this loader has
  // always been the place that decides what `financeVals` is handed. See
  // src/lib/finance.ts, which is untouched.
  const doorListRows = await db.doorListEntry.findMany({
    where: { eventId: row.id },
    orderBy: { name: 'asc' },
  })
  const compsCrew = compsCountFor(doorListRows, row.crew)

  const scen = scenarioOf(row.scen)
  const vals = financeVals({ ...financeInputFor(row, scen, orgShareHours), crew: compsCrew })
  const capacity = capacityOf(row.space, row.format)

  const table = tierTable(row.std, row.door, normaliseMix(row.mix))
  // The one place this page reads how many have sold — see src/lib/gather.ts.
  const sales = readSales(row)
  const pace = paceOf({ sold: sales.sold, breakeven: vals.breakeven })

  // The sales-over-time chart's own data. `today` is fixed once here so the
  // chart's "today" marker and its server-rendered HTML cannot disagree with
  // whatever moment this request actually ran at.
  const today = new Date()
  const history = await salesHistory(row.id)
  const salesPoints: TicketSalePoint[] = history.map((h) => ({
    day: h.day,
    tier: h.tier as MixKey,
    sold: h.sold,
  }))
  const gatherPush = row.channels[0]
  const onSaleAt = gatherPush?.at ?? earliestSaleDay(salesPoints) ?? row.date

  // T6 — the list with state, newest first.
  const codeRows = await db.ticketCode.findMany({
    where: { eventId: row.id },
    orderBy: { createdAt: 'desc' },
  })
  const codes: TicketCodeRow[] = codeRows.map((c) => {
    const state = codeState(c, today)
    return {
      id: c.id,
      code: c.code,
      kind: c.kind,
      valueLabel: codeValueLabel(c.kind, c.value, c.tierKey),
      tierKey: c.tierKey,
      useLimit: c.useLimit,
      uses: c.uses,
      state,
      stateLabel: CODE_STATE_LABELS[state],
      who: c.who,
      whenLabel: `${dateLabel(c.createdAt)}, ${timeLabel(c.createdAt)}`,
    }
  })

  // T7 — grouped by kind, from the same rows `compsCrew` above was read from.
  const doorListEntryRows: DoorListRow[] = doorListRows.map((d) => ({
    id: d.id,
    name: d.name,
    partySize: d.partySize,
    kind: d.kind,
    note: d.note,
    who: d.who,
    addedAt: d.addedAt,
    checkedIn: d.checkedIn,
  }))
  const doorList: DoorListSection = {
    groups: groupDoorList(doorListEntryRows),
    totalPeople: totalPeople(doorListEntryRows),
    compsFromList: doorListEntryRows.some((r) => r.kind === 'COMP'),
  }

  return {
    queue,
    event: {
      id: row.id,
      name: row.name,
      date: dateLabel(row.date),
      spaceName: row.space.name,
      format: row.format,
      bookingLabel: bookingStep(row.bookingStatus.toLowerCase() as BookingStatus).label,
      confirmed: row.bookingStatus === 'CONFIRMED',
      onSale: row.channels.some((c) => c.live),

      std: row.std,
      door: row.door,
      mix: row.mix,
      sold: sales.sold,
      soldAsOf: `${dateLabel(sales.readAt)}, ${timeLabel(sales.readAt)}`,
      capacity,

      tiers: table.map((t) => ({
        key: t.key,
        label: t.label,
        price: money(t.price),
        share: `${Math.round(t.share * 100)}%`,
        contributes: money(t.price * t.share),
      })),
      mixProblem: mixProblem(row.mix),
      average: money(vals.avg),

      breakeven: vals.breakeven,
      fullPay: vals.fullPay,

      salesHistory: salesPoints,
      onSaleAt,
      today,
      doorAt: row.date,
      projectedTotal: pace.projected,

      revenue: money(sales.sold * vals.avg),

      codes,
      doorList,
    },
  }
}

export interface DoorListPrintLoad {
  eventName: string
  eventDate: string
  groups: DoorListGroup[]
  totalPeople: number
}

/**
 * The door list's print view — T7. Takes an already-`requireEvent`-checked
 * id, the same way `setTiers` (actions.ts) operates once it has one, so the
 * scope check happens exactly once per request rather than twice.
 */
export async function loadDoorListPrint(eventId: string): Promise<DoorListPrintLoad> {
  const event = await db.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { name: true, date: true },
  })
  const rows = await db.doorListEntry.findMany({
    where: { eventId },
    orderBy: { name: 'asc' },
  })
  const entries: DoorListRow[] = rows.map((d) => ({
    id: d.id,
    name: d.name,
    partySize: d.partySize,
    kind: d.kind,
    note: d.note,
    who: d.who,
    addedAt: d.addedAt,
    checkedIn: d.checkedIn,
  }))

  return {
    eventName: event.name,
    eventDate: dateLabel(event.date),
    groups: groupDoorList(entries),
    totalPeople: totalPeople(entries),
  }
}
