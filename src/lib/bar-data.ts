import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from './db'
import { eventScope } from './scope'
import { dateLabel, money } from './format'
import { financeVals } from './finance'
import { FINANCE_SELECT, financeInputFor, scenarioOf } from './finance-input'
import { halvesOf } from './actuals'
import { isLate } from './event-record'
import { shiftPlan } from './roster'
import { isConfigured as eposConfigured } from './eposnow'
import {
  barBudgetFrom,
  driverLine,
  isBarRole,
  marginDrag,
  monthRows,
  nightHasCome,
  nightFromActual,
  nightFromBudget,
  serviceWindow,
  tillWindow,
  trailingRates,
  upcomingReforecast,
  varianceOf,
  varianceTone,
  type BarBudgetFigures,
  type BarEventSummary,
  type BarNight,
  type DragRow,
  type MonthRow,
  type Rates,
  type ServiceWindow,
  type SoldLine,
  type Tone,
  type VarianceResult,
} from './bar'
import type { SessionUser } from './session'

/**
 * Loads the bar.
 *
 * The rules — the budget, the variance, the months — are in bar.ts and are
 * tested there. This reads the database and hands them plain shapes, and it
 * computes no money of its own: every projected figure goes through
 * `financeInputFor` and `financeVals`, the same path the settlement takes, so
 * the bar screen cannot price a night differently from Finance.
 */

const BAR_SELECT = {
  ...FINANCE_SELECT,
  id: true,
  name: true,
  bookingStatus: true,
  concluded: true,
  doors: true,
  barClose: true,
  allOut: true,
  kind: true,
  format: true,
  sold: true,
  space: { select: { name: true, capacity: true, seatedCapacity: true } },
  // Overrides FINANCE_SELECT's narrower shifts select, so it has to keep
  // `personId` and `person.employment` — what `financeInputFor` reads to
  // decide whether a shift carries wage cost, and at whose rate.
  shifts: {
    select: { role: true, hours: true, personId: true, person: { select: { employment: true } } },
  },
  actual: {
    select: {
      tickets: true,
      ticketRev: true,
      barTake: true,
      barProfit: true,
      barSource: true,
      barReconciledBy: true,
      barReconciledAt: true,
    },
  },
  barBudget: true,
  // Gather.rsvp's row alone. A night is on sale when it is live — the moment
  // its bar budget locks. See `pushChannel` in the Promotion actions.
  channels: { where: { channel: 'gather' }, select: { live: true } },
  barSales: {
    orderBy: { revenue: 'desc' },
    select: {
      eposProductId: true,
      name: true,
      category: true,
      units: true,
      revenue: true,
      revenueEx: true,
      cost: true,
      costKnown: true,
    },
  },
} as const

type BarRow = Prisma.EventGetPayload<{ select: typeof BAR_SELECT }>

/** Tickets are live on Gather.rsvp. */
const onSale = (row: BarRow): boolean => row.channels.some((c) => c.live)

/**
 * The bar hours planned for the night.
 *
 * The roster's own bar shifts, assigned or not, once there are any. Before the
 * roster exists, the house standard call for this kind of night — the same
 * `shiftPlan` the roster is built from — so an event budgeted early is not
 * budgeted at no labour at all.
 */
function plannedBarHours(row: BarRow): number {
  const bar = row.shifts.filter((s) => isBarRole(s.role))
  if (bar.length > 0) return bar.reduce((n, s) => n + s.hours, 0)

  return shiftPlan({
    space: row.space,
    format: row.format,
    kind: row.kind,
    att: row.att,
    lateBar: isLate(row.barClose),
  })
    .filter((s) => isBarRole(s.role))
    .reduce((n, s) => n + s.hours, 0)
}

/** Bar hours with somebody on them — what the night actually cost in labour. */
const assignedBarHours = (row: BarRow): number =>
  row.shifts.filter((s) => isBarRole(s.role) && s.personId).reduce((n, s) => n + s.hours, 0)

/**
 * The night as the settlement currently projects it.
 *
 * Org-wide labour is passed as zero. It moves the settlement's cost side and
 * never `att` or `barMarg`, which are the only projected figures the bar reads
 * — and asking for it would cost a query per event for a number nothing on
 * this screen shows.
 */
function projectionOf(row: BarRow) {
  const vals = financeVals(financeInputFor(row, scenarioOf(row.scen), 0))
  const figures = barBudgetFrom({ vals, barHead: row.barHead, labourHours: plannedBarHours(row) })
  return { figures, night: nightFromBudget(figures) }
}

function actualOf(row: BarRow): BarNight | null {
  const halves = halvesOf(row.actual)
  if (!halves.bar) return null
  return nightFromActual({
    bar: halves.bar,
    heads: halves.door?.tickets ?? null,
    labourHours: assignedBarHours(row),
  })
}

function summaryOf(row: BarRow): BarEventSummary {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    budget: row.barBudget ? nightFromBudget(row.barBudget) : null,
    projection: projectionOf(row).night,
    actual: actualOf(row),
  }
}

const startOfToday = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate())

async function barRows(user: SessionUser, from: Date): Promise<BarRow[]> {
  // Confirmed bookings. An enquiry is not yet a night anybody should budget a
  // bar for.
  return db.event.findMany({
    where: { AND: [{ bookingStatus: 'CONFIRMED' }, { date: { gte: from } }, eventScope(user)] },
    orderBy: { date: 'asc' },
    select: BAR_SELECT,
    take: 150,
  })
}

// ---------------------------------------------------------------- events ---

export interface BarRailItem {
  id: string
  name: string
  date: string
  figure: string
  note: string
  tone: Tone
}

export interface BarDetail {
  id: string
  name: string
  date: string
  /** Where the night stands for the bar: on sale, not yet, or put to bed. */
  saleLabel: string
  spaceName: string
  window: ServiceWindow
  allOut: string | null
  sold: number

  budget: BarNight | null
  /** How the budget came to be, or when it will. */
  budgetNote: string
  /** On sale already, with no budget: it can be locked now, and says so. */
  canLockLate: boolean

  projection: BarNight
  actual: BarNight | null
  /** Who closed the bar, and off what. */
  actualNote: string | null
  doorCounted: boolean

  variance: VarianceResult | null
  driver: string | null
  /** What sold, against the margin the budget assumed. Only for a bar closed off the till. */
  drag: { rows: DragRow[]; residual: number; missingCost: number } | null
  /** What sold, when there is no budget to hold it against. */
  sales: SoldLine[]

  /** The night has come, so its bar can be closed at all. The action checks the same rule. */
  canClose: boolean
  /** Whether the bar can be closed off Epos Now, and if not, why not. */
  tillReady: boolean
  tillWhy: string | null
  /** The bar half as it stands, for the close form. */
  barHalf: { barTake: number; barProfit: number } | null
}

export interface BarEventsLoad {
  rail: BarRailItem[]
  event: BarDetail | null
  eposConnected: boolean
}

const RAIL_LOOKBACK_DAYS = 90

function railItem(row: BarRow, now: Date): BarRailItem {
  const s = summaryOf(row)
  const base = { id: row.id, name: row.name, date: dateLabel(row.date) }

  if (s.actual) {
    if (!s.budget) {
      return { ...base, figure: money(s.actual.take), note: 'closed · no budget', tone: 'plain' }
    }
    const v = varianceOf(s.budget, s.actual)
    const over = v.contributionVariance
    return {
      ...base,
      figure: money(s.actual.take),
      note: `closed · ${money(Math.abs(over))} ${over < 0 ? 'under' : 'over'}`,
      tone: varianceTone(over),
    }
  }

  // Every row is a confirmed booking, so a night behind us is one that
  // happened — and one with no bar half is a bar nobody has closed.
  if (row.date < startOfToday(now)) {
    return { ...base, figure: money(s.projection.take), note: 'bar not closed', tone: 'warn' }
  }

  if (s.budget) return { ...base, figure: money(s.budget.take), note: 'budget', tone: 'plain' }
  return { ...base, figure: money(s.projection.take), note: 'projected', tone: 'plain' }
}

const sourceWords = (source: string | null) =>
  source === 'POS' ? 'off Epos Now' : source === 'MANUAL' ? 'by hand' : ''

export async function loadBarEvents(
  user: SessionUser,
  wantedId: string | undefined,
): Promise<BarEventsLoad> {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - RAIL_LOOKBACK_DAYS)
  const rows = await barRows(user, from)
  const eposConnected = eposConfigured()

  const rail = rows.map((r) => railItem(r, now))

  // The next night through the door, unless somebody asked for another.
  const upcoming = rows.find((r) => r.date >= startOfToday(now))
  const chosen = rows.find((r) => r.id === wantedId) ?? upcoming ?? rows[rows.length - 1] ?? null
  if (!chosen) return { rail, event: null, eposConnected }

  const s = summaryOf(chosen)
  const halves = halvesOf(chosen.actual)
  const window = serviceWindow(chosen.doors, chosen.barClose)
  const hasWindow = tillWindow(chosen.date, chosen.doors, chosen.barClose) !== null

  const b = chosen.barBudget
  const budgetNote = b
    ? b.basis === 'LATE'
      ? `locked late, ${dateLabel(b.lockedAt)}${b.lockedBy ? ` by ${b.lockedBy}` : ''} — this was on sale before bar budgets existed`
      : `locked when it went on sale, ${dateLabel(b.lockedAt)}${b.lockedBy ? ` by ${b.lockedBy}` : ''}`
    : onSale(chosen)
      ? 'no budget — this went on sale before bar budgets existed'
      : 'locks when this goes on sale'

  const sales: SoldLine[] = chosen.barSales.map((l) => ({ ...l }))
  const variance = s.budget && s.actual ? varianceOf(s.budget, s.actual) : null

  return {
    rail,
    eposConnected,
    event: {
      id: chosen.id,
      name: chosen.name,
      date: dateLabel(chosen.date),
      saleLabel: chosen.concluded ? 'put to bed' : onSale(chosen) ? 'on sale' : 'not on sale yet',
      spaceName: chosen.space.name,
      window,
      allOut: chosen.allOut,
      sold: chosen.sold,

      budget: s.budget,
      budgetNote,
      canLockLate: !b && onSale(chosen),

      projection: s.projection,
      actual: s.actual,
      actualNote: chosen.actual?.barReconciledBy
        ? `closed ${sourceWords(chosen.actual.barSource)} by ${chosen.actual.barReconciledBy}`
        : s.actual
          ? `closed ${sourceWords(chosen.actual?.barSource ?? null)}`.trim()
          : null,
      doorCounted: halves.door !== null,

      variance,
      driver: variance ? driverLine(variance) : null,
      drag:
        s.budget && s.actual && sales.length > 0
          ? marginDrag(sales, s.budget.marginPct, s.actual)
          : null,
      sales,

      canClose: nightHasCome(chosen.date, now),
      tillReady: eposConnected && hasWindow,
      tillWhy: !eposConnected
        ? 'Epos Now is not connected on this install, so the bar is closed by hand.'
        : !hasWindow
          ? 'Doors and bar close are not both set on the event record, so there is no window to read the till for.'
          : null,
      barHalf: halves.bar,
    },
  }
}

// ---------------------------------------------------------------- months ---

export interface BarMonthsLoad {
  rows: MonthRow[]
  rates: Rates | null
  ahead: { nights: number; planned: number; reforecast: number; gap: number } | null
  eposConnected: boolean
}

const MONTHS_BACK = 6

export async function loadBarMonths(user: SessionUser): Promise<BarMonthsLoad> {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - MONTHS_BACK, 1)
  const summaries = (await barRows(user, from)).map(summaryOf)

  const rates = trailingRates(summaries, now)
  return {
    rows: monthRows(summaries),
    rates,
    ahead: rates ? upcomingReforecast(summaries, rates, now) : null,
    eposConnected: eposConfigured(),
  }
}

// ------------------------------------------------------------------ lock ---

/**
 * The budget as it would be locked right now, off the current projection.
 *
 * Called when tickets first go live on Gather.rsvp, and by the late lock for
 * an event already on sale. Never used to change a budget that exists —
 * nothing does.
 */
export async function budgetToLock(eventId: string): Promise<BarBudgetFigures | null> {
  const row = await db.event.findUnique({ where: { id: eventId }, select: BAR_SELECT })
  return row ? projectionOf(row).figures : null
}

/** The night's date and run times, for reading the till. */
export async function tillWindowFor(
  eventId: string,
): Promise<{ start: string; end: string } | null> {
  const row = await db.event.findUnique({
    where: { id: eventId },
    select: { date: true, doors: true, barClose: true },
  })
  return row ? tillWindow(row.date, row.doors, row.barClose) : null
}
