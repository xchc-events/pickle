import 'server-only'
import { db } from './db'
import { financeVals } from './finance'
import { FINANCE_SELECT, financeInputFor, scenarioOf } from './finance-input'
import type { PipelineEvent } from './pipeline'
import { eventScope } from './scope'
import { halvesOf, takenOf } from './actuals'
import { partsFor } from './parts'
import { PARTS_SELECT, partsInputFor } from './parts-input'
import type { SessionUser } from './session'
import { hasPortalFor, portalCoordinatorsByOrganisation } from './portal-access'

/**
 * Loads the pipeline.
 *
 * The scope clause comes from src/lib/permissions.ts and goes into the query,
 * so an external promoter's rows never leave the database. Every figure is
 * computed by src/lib/finance.ts, and every part's status by
 * src/lib/parts.ts — nothing is recomputed here.
 */

const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`

// Both FINANCE_SELECT and PARTS_SELECT want artists, shifts and tasks, and a
// spread keeps only the last one — so they are written out whole here, with
// every column either one reads, the same pattern HOME_SELECT in
// home-data.ts uses. `person.employment` is what `financeInputFor` blends
// the wage cost from.
const PIPELINE_SELECT = {
  ...PARTS_SELECT,
  ...FINANCE_SELECT,
  id: true,
  name: true,
  endDate: true,
  packIn: true,
  packOut: true,
  riskNote: true,
  riskKind: true,
  internal: true,
  actual: true,
  owner: { select: { name: true, initials: true } },
  artists: {
    select: {
      low: true,
      high: true,
      status: true,
      payee: { select: { files: { select: { kind: true } } } },
    },
  },
  shifts: {
    select: { hours: true, personId: true, state: true, person: { select: { employment: true } } },
  },
  tasks: { select: { est: true, actual: true, name: true } },
} as const

export async function loadPipeline(user: SessionUser): Promise<PipelineEvent[]> {
  const events = await db.event.findMany({
    where: eventScope(user),
    select: PIPELINE_SELECT,
    orderBy: { date: 'asc' },
  })

  // Org-wide labour is pooled by month, then split across that month's
  // events — an event in a busy month carries a smaller share of it.
  const orgEntries = await db.hourEntry.findMany({
    where: { eventId: null },
    select: { hours: true, createdAt: true },
  })
  const orgByMonth = new Map<string, number>()
  for (const h of orgEntries) {
    const k = monthKey(h.createdAt)
    orgByMonth.set(k, (orgByMonth.get(k) ?? 0) + h.hours)
  }
  const eventsByMonth = new Map<string, number>()
  for (const e of events) {
    const k = monthKey(e.date)
    eventsByMonth.set(k, (eventsByMonth.get(k) ?? 0) + 1)
  }

  // The outside coordinator for each organisation — the row's avatar, and
  // the same map the portal gates are answered from, so this screen asks the
  // question once. See src/lib/portal-access.ts.
  const coordinators = await portalCoordinatorsByOrganisation()

  const now = new Date()

  return events.map((e) => {
    const k = monthKey(e.date)
    const orgShareHours = (orgByMonth.get(k) ?? 0) / (eventsByMonth.get(k) || 1)

    // The same assembly, and the same blended wage cost, every other screen
    // that prices a night uses — see src/lib/finance-input.ts.
    const v = financeVals(financeInputFor(e, scenarioOf(e.scen), orgShareHours))

    // One decision, read twice: the row's avatar cannot name a coordinator
    // the gates below have already decided there is no portal for.
    const hasPortal = hasPortalFor(e, coordinators)
    const ext = hasPortal && e.promoterId ? coordinators.get(e.promoterId) : undefined

    const input = partsInputFor(e, {
      hasPortal,
      floor: v.floor,
      ceil: v.ceil,
      actual: e.actual,
      now,
    })

    return {
      id: e.id,
      name: e.name,
      promoter: e.promoter ?? '',
      format: e.format,
      spaceName: e.space.name,
      concluded: e.concluded,
      booking: input.booking,
      daysToDoor: input.daysToDoor,
      date: e.date,
      endDate: e.endDate,
      doors: e.doors,
      allOut: e.allOut,
      packIn: e.packIn,
      packOut: e.packOut,
      riskNote: e.riskNote,
      riskKind: e.riskKind === 'STOP' ? 'stop' : 'warn',
      ownerInitials: e.owner?.initials ?? null,
      ownerName: e.owner?.name ?? null,
      // The prototype accents exactly one avatar: the coordinator's.
      ownerAccent: e.owner?.initials === 'MT',
      extCoordInitials: ext?.initials ?? null,
      extCoordName: ext?.name ?? null,
      surplus: v.ours,
      // Only true of a whole night — see takenOf.
      actualTotal: takenOf(halvesOf(e.actual)),
      hours: v.hours,
      taskHours: e.tasks.map((t) => ({ team: t.name, hours: t.actual ?? t.est })),
      onSiteHours: e.shifts.filter((s) => s.personId).reduce((a, s) => a + s.hours, 0),
      parts: partsFor(input),
    } satisfies PipelineEvent
  })
}
