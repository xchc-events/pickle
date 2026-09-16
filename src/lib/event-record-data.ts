import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { ago, dateLabel, days, hrs, money } from './format'
import { financeVals, CFG, type FinanceVals } from './finance'
import { FINANCE_SELECT, financeInputFor, orgShareFor, scenarioOf } from './finance-input'
import { marginHealth } from './finance'
import { capacityOf, tierTable, normaliseMix, sellThrough, paceOf } from './ticketing'
import { channelCards } from './promo'
import { daysBetween } from './pipeline'
import { halvesOf, type BarClose, type DoorCount } from './actuals'
import {
  gatesDoneLabel,
  isLate,
  type DealState,
  type LeadKey,
  type LicenceState,
  type TechStatus,
} from './event-record'
import {
  bookingStep,
  nextMove,
  partsFor,
  type BookingStatus,
  type NextMove,
  type PartState,
} from './parts'
import { partsInputFor } from './parts-input'
import type { SessionUser } from './session'

/**
 * Loads the event record — the hub the handoff calls it.
 *
 * Every figure on this page resolves back through `financeVals`, and every
 * part and its gates through `partsFor`. This file assembles and presents; it
 * works nothing out for itself. The one number it is tempted to compute
 * inline is the fee floor, and that comes off `financeVals` too, because the
 * gate that reads it and the Terms panel that shows it must not be able to
 * disagree.
 */

export interface RecordLead {
  role: LeadKey
  label: string
  icon: string
  personId: string | null
  name: string | null
}

const LEAD_DEFS: readonly { role: LeadKey; label: string; icon: string }[] = [
  { role: 'ticketing', label: 'Ticketing', icon: 'ph-ticket' },
  { role: 'design', label: 'Design', icon: 'ph-tag' },
  { role: 'promo', label: 'Promo', icon: 'ph-megaphone' },
  { role: 'tech', label: 'Tech', icon: 'ph-sliders' },
]

export interface RecordFact {
  key: string
  value: string
  note: string
}

export interface RecordArtist {
  id: string
  name: string
  status: string
  low: number
  high: number
  payeeName: string | null
  /** Which of the five pieces the house asks of an act are on file. */
  files: { kind: string; label: string; icon: string; have: boolean }[]
}

export interface RecordChannel {
  key: string
  name: string
  icon: string
  state: 'not out' | 'out of date' | 'in sync'
  tone: 'good' | 'warn' | 'stop' | 'plain'
  note: string | null
}

export interface RecordRoleRow {
  role: string
  hours: number
  cost: string
  people: { name: string; initials: string; paid: boolean }[]
  open: number
}

export interface RecordTask {
  id: string
  name: string
  est: number
  actual: number | null
  variance: string
  cost: string
}

export interface RecordActivity {
  who: string
  text: string
  when: string
}

/** A part of the event, with the count beside its gates already worded. */
export type RecordPart = PartState & { gatesDone: string }

export interface EventRecord {
  id: string
  name: string
  date: string
  dateTbc: boolean
  booking: BookingStatus
  bookingLabel: string
  nickname: string
  /** Days the booking has sat at its current status. */
  bookingDays: number
  spaceName: string
  format: string
  kind: string
  promoter: string
  internal: boolean
  concluded: boolean
  model: 'dry' | 'curator'
  modelLabel: string
  daysToDoor: string
  /** The night is today or behind us. What it took can be counted from here. */
  nightHasCome: boolean

  ownerName: string | null
  ownerInitials: string | null
  leads: RecordLead[]
  facts: RecordFact[]

  /** Where each of the eight parts stands, in pipeline order. */
  parts: RecordPart[]
  /** The one thing a person presses next, or null when there is nothing. */
  next: (NextMove & { gatesDone: string }) | null

  deal: DealState
  dealNote: string | null
  licence: LicenceState
  licenceLate: boolean
  techStatus: TechStatus

  doors: string | null
  barClose: string | null
  allOut: string | null

  // --- money, all from financeVals ---
  std: number
  door: number
  tiers: { key: string; label: string; price: string; share: string }[]
  split: number
  theirFloor: string
  theirShare: string
  theirTotal: string
  ourShare: string
  surplus: string
  ceiling: string
  fullPayAt: number
  hours: string
  ourPeople: string
  orgHours: string
  orgCost: string
  margin: string
  marginHealth: 'loss' | 'thin' | 'healthy'
  /** The door half of the night, once counted. See src/lib/actuals.ts. */
  doorHalf: DoorCount | null
  /**
   * The bar half of the night, once closed. Not `barClose` — that is the run
   * time the bar shuts at, above.
   */
  barHalf: BarClose | null

  sold: number
  capacity: number
  sellThroughPct: number
  breakeven: number
  paceNote: string
  paceTone: 'good' | 'warn' | 'stop' | 'plain'

  artists: RecordArtist[]
  artistFloor: string
  artistCeil: string

  roleRows: RecordRoleRow[]
  onSiteHours: number
  tasks: RecordTask[]
  offSiteHours: number
  loggedHours: string

  channels: RecordChannel[]
  staleCount: number

  activity: RecordActivity[]
}

/**
 * The five pieces the house asks of every act, and the file kind each maps to.
 * Specification — the same list the prototype ticks off on the artist row.
 */
const ARTIST_FILES: readonly { kind: string; label: string; icon: string }[] = [
  { kind: 'PRESS_SHOT', label: 'Promo pics', icon: 'ph-image' },
  { kind: 'BIO', label: 'Bio', icon: 'ph-text-align-left' },
  { kind: 'EPK', label: 'EPK', icon: 'ph-folder-open' },
  { kind: 'RIDER_HOSPITALITY', label: 'Hospitality rider', icon: 'ph-fork-knife' },
  { kind: 'RIDER_TECH', label: 'Tech rider', icon: 'ph-sliders' },
]

/**
 * One event, in full, or null when it is not this user's to see.
 *
 * The scope clause goes into the query rather than into a check afterwards —
 * the same rule as `requireEvent`. An event outside an external promoter's
 * org never leaves the database.
 */
export async function loadEventRecord(
  user: SessionUser,
  eventId: string,
): Promise<EventRecord | null> {
  const row = await db.event.findFirst({
    where: { AND: [{ id: eventId }, eventScope(user)] },
    select: {
      ...FINANCE_SELECT,
      id: true,
      name: true,
      dateTbc: true,
      bookingStatus: true,
      bookingStatusSince: true,
      ownerId: true,
      concluded: true,
      model: true,
      licence: true,
      deal: true,
      dealNote: true,
      techStatus: true,
      doors: true,
      barClose: true,
      allOut: true,
      kind: true,
      format: true,
      promoter: true,
      internal: true,
      sold: true,
      space: { select: { name: true, capacity: true, seatedCapacity: true } },
      owner: { select: { name: true, initials: true } },
      leads: { select: { role: true, personId: true, person: { select: { name: true } } } },
      assets: { select: { key: true, state: true, promoterSigned: true } },
      channels: { select: { channel: true, live: true, stale: true, note: true } },
      beats: { select: { done: true } },
      activity: { orderBy: { at: 'desc' }, take: 20, select: { who: true, text: true, at: true } },
      artists: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          name: true,
          status: true,
          low: true,
          high: true,
          payee: { select: { name: true, files: { select: { kind: true } } } },
        },
      },
      files: { select: { kind: true, assetId: true, current: true, scan: true } },
      // Overrides FINANCE_SELECT's narrower shifts select, so it has to keep
      // `personId` — that is what `financeInputFor` reads to decide whether a
      // shift carries wage cost.
      shifts: {
        select: {
          role: true,
          hours: true,
          state: true,
          personId: true,
          person: { select: { name: true, initials: true } },
        },
      },
      tasks: { select: { id: true, name: true, est: true, actual: true } },
      hours: { select: { hours: true, paid: true } },
    },
  })

  if (!row) return null

  const orgShareHours = await orgShareFor(row.date)
  const scen = scenarioOf(row.scen)
  const vals: FinanceVals = financeVals(financeInputFor(row, scen, orgShareHours))

  const leadBy = new Map(row.leads.map((l) => [l.role.toLowerCase() as LeadKey, l]))
  const licence = row.licence.toLowerCase() as LicenceState
  const techStatus = row.techStatus.toLowerCase() as TechStatus
  const deal = row.deal.toLowerCase() as DealState

  // An external promoter with an account is somebody the venue can chase in a
  // portal rather than by email — several gates word themselves off that.
  //
  // Matched the way `promUser` does in the prototype: the org name is a
  // substring of the event's promoter field. That is a comparison Postgres
  // cannot express against a column, so the candidates come back and the
  // match happens in memory — exactly as pipeline-data matches it, so a part
  // reads the same on both screens.
  const externals = await db.user.findMany({
    where: { role: 'PROMOTER', active: true, promoter: { not: null } },
    select: { promoter: true },
  })
  const hasPortal =
    !row.internal && externals.some((u) => u.promoter && (row.promoter ?? '').includes(u.promoter))

  // Per-act file presence. A file counts whether it arrived on the event or on
  // the payee record — an act that sent their bio last time has sent their bio.
  const eventKinds = new Set<string>(row.files.map((f) => f.kind))
  const artists: RecordArtist[] = row.artists.map((a) => {
    const payeeKinds = new Set<string>((a.payee?.files ?? []).map((f) => f.kind))
    return {
      id: a.id,
      name: a.name,
      status: a.status.toLowerCase(),
      low: a.low,
      high: a.high,
      payeeName: a.payee?.name ?? null,
      files: ARTIST_FILES.map((f) => ({
        ...f,
        have: payeeKinds.has(f.kind) || eventKinds.has(f.kind),
      })),
    }
  })

  // Actual is a one-to-one the finance select does not carry, so it needs its
  // own read. The figures come back with it rather than just whether they
  // exist: the forms on this page edit them, and a form that could only create
  // would make a typo permanent.
  const actual = await db.actual.findUnique({
    where: { eventId: row.id },
    select: { tickets: true, ticketRev: true, barTake: true, barProfit: true },
  })
  const halves = halvesOf(actual)

  const now = new Date()
  const input = partsInputFor(row, {
    hasPortal,
    floor: vals.floor,
    ceil: vals.ceil,
    actual,
    now,
  })
  const next = nextMove(input)

  const capacity = capacityOf(row.space, row.format)
  const pace = paceOf({ sold: row.sold, breakeven: vals.breakeven })
  const health = marginHealth(vals)

  // On-site labour, grouped by role, exactly as the roster holds it.
  const byRole = new Map<string, RecordRoleRow>()
  for (const s of row.shifts) {
    const existing = byRole.get(s.role) ?? {
      role: s.role,
      hours: 0,
      cost: '',
      people: [],
      open: 0,
    }
    existing.hours += s.hours
    if (s.person) {
      existing.people.push({ name: s.person.name, initials: s.person.initials, paid: false })
    } else {
      existing.open += 1
    }
    byRole.set(s.role, existing)
  }
  const roleRows = [...byRole.values()].map((r) => ({
    ...r,
    cost: money(r.hours * CFG.loaded),
  }))

  const onSiteHours = row.shifts.filter((s) => s.person !== null).reduce((n, s) => n + s.hours, 0)
  const offSiteHours = row.tasks.reduce((n, t) => n + (t.actual ?? t.est), 0)

  const step = bookingStep(input.booking)

  return {
    id: row.id,
    name: row.name,
    date: dateLabel(row.date),
    dateTbc: row.dateTbc,
    booking: input.booking,
    bookingLabel: step.label,
    nickname: step.nick,
    bookingDays: input.bookingDays,
    spaceName: row.space.name,
    format: row.format,
    kind: row.kind,
    promoter: row.promoter ?? (row.internal ? 'XCHC' : 'unassigned'),
    internal: row.internal,
    concluded: row.concluded,
    model: row.model === 'DRY' ? 'dry' : 'curator',
    modelLabel: row.model === 'DRY' ? 'Dry hire' : 'Curator model',
    daysToDoor: days(daysBetween(now, row.date)),
    nightHasCome: input.daysToDoor <= 0,

    ownerName: row.owner?.name ?? null,
    ownerInitials: row.owner?.initials ?? null,
    leads: LEAD_DEFS.map((d) => {
      const found = leadBy.get(d.role)
      return {
        ...d,
        personId: found?.personId ?? null,
        name: found?.person.name ?? null,
      }
    }),

    facts: [
      {
        key: 'Booking model',
        value: row.model === 'DRY' ? 'Dry hire' : 'Curator model',
        note: 'drives which milestones apply',
      },
      { key: 'Kind of night', value: row.kind, note: 'drives the roster' },
      { key: 'Format', value: row.format, note: 'what the room is told it is' },
      { key: 'Space', value: row.space.name, note: `holds ${capacity}` },
      // Doors, bar close and everyone-out are not repeated here — they are
      // editable a few lines below in RunTimes, and a read-only copy beside an
      // editable one is two places showing the same field.
    ],

    parts: partsFor(input).map((p) => ({ ...p, gatesDone: gatesDoneLabel(p.checks) })),
    next: next ? { ...next, gatesDone: gatesDoneLabel(next.gates) } : null,

    deal,
    dealNote: row.dealNote,
    licence,
    licenceLate: isLate(row.barClose),
    techStatus,

    doors: row.doors,
    barClose: row.barClose,
    allOut: row.allOut,

    std: row.std,
    door: row.door,
    tiers: tierTable(row.std, row.door, normaliseMix(row.mix)).map((t) => ({
      key: t.key,
      label: t.label,
      price: money(t.price),
      share: `${Math.round(t.share * 100)}%`,
    })),
    split: row.split,
    theirFloor: money(vals.floor),
    theirShare: money(vals.theirShare),
    theirTotal: money(vals.theirTotal),
    ourShare: money(vals.ours),
    surplus: money(vals.surplus),
    ceiling: money(vals.ceil),
    fullPayAt: vals.fullPay,
    hours: hrs(vals.hours),
    ourPeople: money(vals.ourPeople),
    orgHours: hrs(orgShareHours),
    orgCost: money(vals.orgCost),
    margin: `${Math.round(health.margin * 100)}%`,
    marginHealth: health.health,
    doorHalf: halves.door,
    barHalf: halves.bar,

    sold: row.sold,
    capacity,
    sellThroughPct: sellThrough(row.sold, capacity),
    breakeven: vals.breakeven,
    paceNote: pace.note,
    paceTone: pace.tone,

    artists,
    artistFloor: money(vals.floor),
    artistCeil: money(vals.ceil),

    roleRows,
    onSiteHours,
    tasks: row.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      est: t.est,
      actual: t.actual,
      variance:
        t.actual === null
          ? '—'
          : `${t.actual - t.est > 0 ? '+' : ''}${Math.round((t.actual - t.est) * 10) / 10}h`,
      cost: money((t.actual ?? t.est) * CFG.loaded),
    })),
    offSiteHours,
    loggedHours: hrs(row.hours.reduce((n, h) => n + h.hours, 0)),

    channels: channelCards(
      row.channels.map((c) => ({
        channel: c.channel,
        live: c.live,
        stale: c.stale,
        note: c.note,
        byName: null,
        when: null,
      })),
    ).map((c) => ({
      key: c.key,
      name: c.name,
      icon: c.icon,
      state: c.state,
      tone: c.tone,
      note: c.note,
    })),
    staleCount: row.channels.filter((c) => c.stale).length,

    activity: row.activity.map((a) => ({
      who: a.who,
      text: a.text,
      when: ago(a.at, now),
    })),
  }
}
