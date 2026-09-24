import 'server-only'
import { db } from './db'
import { financeVals } from './finance'
import { FINANCE_SELECT, financeInputFor, orgShareFor, scenarioOf } from './finance-input'
import { dateLabel } from './format'
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
import { hasPortalFor, organisationsWithPortal } from './portal-access'

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

/** A shift offered to the reader themself, waiting on their own yes or no. */
export interface OfferedShiftRow {
  shiftId: string
  eventName: string
  when: string
  role: string
  hours: number
}

export interface HomeLoad {
  needs: Need[]
  /** Events not yet put to bed. */
  live: number
  tiles: Tile[]
  /** Up to the two soonest confirmed nights, soonest first. */
  next: NextNight[]
  /**
   * The reader's hours, or 'unlinked' for an account with no person behind
   * it; null when the reader cannot open Hours.
   */
  hours: MyHours | 'unlinked' | null
  /** Shifts offered to the reader themself — R6. Empty for an account with
   *  no linked person, same as `hours`. */
  offers: OfferedShiftRow[]
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
  shifts: {
    select: { hours: true, personId: true, state: true, person: { select: { employment: true } } },
  },
  tasks: { select: { est: true, actual: true } },
} as const

export async function loadHome(user: SessionUser, modules: ModuleKey[]): Promise<HomeLoad> {
  const now = new Date()
  const viewer: Viewer = { personId: user.personId, modules }

  const [rows, portalOrgs, accounts, permissions, countedRows, offeredShifts] = await Promise.all([
    db.event.findMany({
      where: { AND: [eventScope(user), { concluded: false }] },
      select: HOME_SELECT,
      orderBy: { date: 'asc' },
    }),
    organisationsWithPortal(),
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
    // Shifts offered to the reader themself — R6. Scoped to their own
    // personId, same as `hoursOf` below; an account with none linked is
    // never asked a database question it cannot answer.
    user.personId
      ? db.shift.findMany({
          where: { personId: user.personId, state: 'OFFERED', event: { concluded: false } },
          select: {
            id: true,
            role: true,
            hours: true,
            event: { select: { name: true, date: true } },
          },
          orderBy: { event: { date: 'asc' } },
        })
      : Promise.resolve([]),
  ])

  const actors = actorsOf(accounts, modulesOpenByRole(permissions))

  const events: HomeEvent[] = rows.map((row) => {
    // The portal rule the event record, the Pipeline and Design share.
    const hasPortal = hasPortalFor(row, portalOrgs)

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

  // Up to the two soonest confirmed nights. Each one's surplus is the event
  // record's own figure, worked out exactly as the event record works it
  // out, and only for a reader who can open it — the same rule as when this
  // only ever showed the one night.
  const next = await Promise.all(
    pickNext(events, 2).map(async (e) => {
      let surplus: number | null = null
      if (modules.includes('pipeline')) {
        const row = rows.find((r) => r.id === e.id)
        if (row) {
          const orgShareHours = await orgShareFor(row.date)
          surplus = financeVals(financeInputFor(row, scenarioOf(row.scen), orgShareHours)).surplus
        }
      }
      return nextNight(e, viewer, surplus)
    }),
  )

  return {
    needs: needsFor(events, viewer, actors),
    live: events.length,
    tiles: homeTiles(events, counted, projected, viewer),
    next,
    hours: modules.includes('hours') ? await hoursOf(user.personId, now) : null,
    offers: offeredShifts.map((s) => ({
      shiftId: s.id,
      eventName: s.event.name,
      when: dateLabel(s.event.date),
      role: s.role,
      hours: s.hours,
    })),
  }
}

async function hoursOf(personId: string | null, now: Date): Promise<MyHours | 'unlinked'> {
  if (!personId) return 'unlinked'

  // This month by the day the work happened, as Hours has it.
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const [entries, availability, person] = await Promise.all([
    db.hourEntry.findMany({
      where: { personId, workedOn: { gte: from, lt: to } },
      select: { hours: true, workedOn: true, shiftId: true },
    }),
    db.availability.findUnique({
      where: { personId },
      select: { weekly: true, volunteer: true },
    }),
    db.person.findUnique({ where: { id: personId }, select: { employment: true } }),
  ])

  return myHours({
    now,
    availability,
    entries: entries.map((e) => ({
      hours: e.hours,
      workedOn: e.workedOn,
      rostered: e.shiftId !== null,
    })),
    // Defaults to a contractor's rate in the unreachable case of a linked
    // person record that has since gone — everyone who is not an employee is
    // a contractor.
    employment: person?.employment ?? 'CONTRACTOR',
  })
}
