import 'server-only'
import { db } from './db'
import { financeVals } from './finance'
import { FINANCE_SELECT, financeInputFor, orgShareFor, scenarioOf } from './finance-input'
import { PARTS_SELECT, partsInputFor } from './parts-input'
import { halvesOf, takenOf } from './actuals'
import { eventScope, modulesOpenByRole } from './scope'
import { daysBetween } from './pipeline'
import type { ModuleKey } from './constants'
import type { LeadKey } from './event-record'
import type { SessionUser } from './session'
import {
  actorsOf,
  homeTiles,
  inRevenueWindow,
  myHours,
  needsFor,
  nextNight,
  pickNext,
  REVENUE_DAYS,
  type CountedNight,
  type HomeEvent,
  type MyHours,
  type Need,
  type NextNight,
  type Tile,
  type Viewer,
} from './home'

/**
 * Loads Home.
 *
 * Everything Home says is decided in src/lib/home.ts, over parts worked out by
 * src/lib/parts.ts from the same columns the Pipeline and the event record
 * read them from. This file only fetches, and fetches no more than the reader
 * may see: every event query carries the scope clause, the next night's
 * surplus is only worked out for someone who can open the event record that
 * shows it, and the hours are only ever the reader's own.
 */

export interface HomeLoad {
  needs: Need[]
  /** Events not yet put to bed. */
  live: number
  tiles: Tile[]
  next: NextNight | null
  /**
   * The reader's hours, or 'unlinked' for an account with no person behind
   * it; null when the reader cannot open Hours.
   */
  hours: MyHours | 'unlinked' | null
}

const HOME_SELECT = {
  ...PARTS_SELECT,
  ...FINANCE_SELECT,
  id: true,
  name: true,
  internal: true,
  riskNote: true,
  actual: true,
  // Both selects want these relations, and a spread keeps only the last —
  // so they are written out whole, with every column either one reads.
  leads: { select: { role: true, personId: true } },
  artists: {
    select: {
      status: true,
      low: true,
      high: true,
      payee: { select: { files: { select: { kind: true } } } },
    },
  },
  shifts: { select: { hours: true, personId: true, state: true } },
  tasks: { select: { est: true, actual: true } },
} as const

export async function loadHome(user: SessionUser, modules: ModuleKey[]): Promise<HomeLoad> {
  const now = new Date()
  const viewer: Viewer = { personId: user.personId, modules }

  const [rows, promoters, accounts, permissions, countedRows] = await Promise.all([
    db.event.findMany({
      where: { AND: [eventScope(user), { concluded: false }] },
      select: HOME_SELECT,
      orderBy: { date: 'asc' },
    }),
    db.user.findMany({
      where: { role: 'PROMOTER', active: true, promoter: { not: null } },
      select: { promoter: true },
    }),
    // Everybody who could act on something. An outside account never can —
    // the event record refuses them — so none is counted, whatever it is linked to.
    db.user.findMany({
      where: { active: true, personId: { not: null }, role: { not: 'PROMOTER' } },
      select: { personId: true, role: true },
    }),
    db.modulePermission.findMany({ select: { role: true, module: true } }),
    // Nights inside the Revenue tile's actual window, both halves in. The
    // extra two days' buffer on the cutoff covers the gap between this clock
    // instant and the calendar-day boundary `daysBetween` checks below; the
    // exact cut to REVENUE_DAYS happens there, not in this query.
    db.event.findMany({
      where: {
        AND: [
          eventScope(user),
          { date: { gte: new Date(now.getTime() - (REVENUE_DAYS + 2) * 86_400_000), lt: now } },
          { actual: { is: { ticketRev: { not: null }, barProfit: { not: null } } } },
        ],
      },
      select: { date: true, actual: true },
      orderBy: { date: 'desc' },
    }),
  ])

  const actors = actorsOf(accounts, modulesOpenByRole(permissions))

  const events: HomeEvent[] = rows.map((row) => {
    // The portal rule the event record and the Pipeline word their gates off:
    // an outside promoter with an active account can be chased in it.
    const hasPortal =
      !row.internal &&
      promoters.some((u) => u.promoter && (row.promoter ?? '').includes(u.promoter))

    // The fee floor and ceiling are the acts' own ranges; the org-wide share
    // does not touch them, so it is not worked out for every event here.
    const { floor, ceil } = financeVals(financeInputFor(row, scenarioOf(row.scen), 0))

    const leads: Partial<Record<LeadKey, string>> = {}
    for (const l of row.leads) leads[l.role.toLowerCase() as LeadKey] = l.personId

    return {
      id: row.id,
      name: row.name,
      date: row.date,
      spaceName: row.space.name,
      format: row.format,
      ownerId: row.ownerId,
      leads,
      riskNote: row.riskNote,
      input: partsInputFor(row, { hasPortal, floor, ceil, actual: row.actual, now }),
    }
  })

  const counted: CountedNight[] = countedRows.flatMap((r) => {
    const taken = takenOf(halvesOf(r.actual))
    return taken === null ? [] : [{ daysAgo: daysBetween(r.date, now), taken }]
  })

  // The Revenue tile's projected figure: financeVals' own income, summed over
  // the same nights inRevenueWindow selects — worked out only for a reader
  // who can open Finance, since nobody else's tile reads it.
  let projected = 0
  if (modules.includes('finance')) {
    const toProject = events.flatMap((e) => {
      if (!inRevenueWindow(e)) return []
      const row = rows.find((r) => r.id === e.id)
      return row ? [row] : []
    })
    const incomes = await Promise.all(
      toProject.map(async (row) => {
        const orgShareHours = await orgShareFor(row.date)
        return financeVals(financeInputFor(row, scenarioOf(row.scen), orgShareHours)).income
      }),
    )
    projected = incomes.reduce((n, x) => n + x, 0)
  }

  // The surplus is the event record's own figure, worked out exactly as the
  // event record works it out — and only for a reader who can open it.
  const nextEvent = pickNext(events)
  let surplus: number | null = null
  if (nextEvent && modules.includes('pipeline')) {
    const row = rows.find((r) => r.id === nextEvent.id)
    if (row) {
      const orgShareHours = await orgShareFor(row.date)
      surplus = financeVals(financeInputFor(row, scenarioOf(row.scen), orgShareHours)).surplus
    }
  }

  return {
    needs: needsFor(events, viewer, actors),
    live: events.length,
    tiles: homeTiles(events, counted, projected, viewer),
    next: nextEvent ? nextNight(nextEvent, viewer, surplus) : null,
    hours: modules.includes('hours') ? await hoursOf(user.personId, now) : null,
  }
}

async function hoursOf(personId: string | null, now: Date): Promise<MyHours | 'unlinked'> {
  if (!personId) return 'unlinked'

  // This month by the day the work happened, as Hours has it.
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const [entries, availability] = await Promise.all([
    db.hourEntry.findMany({
      where: { personId, workedOn: { gte: from, lt: to } },
      select: { hours: true, workedOn: true, shiftId: true },
    }),
    db.availability.findUnique({
      where: { personId },
      select: { weekly: true, volunteer: true },
    }),
  ])

  return myHours({
    now,
    availability,
    entries: entries.map((e) => ({
      hours: e.hours,
      workedOn: e.workedOn,
      rostered: e.shiftId !== null,
    })),
  })
}
