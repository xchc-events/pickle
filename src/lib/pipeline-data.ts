import 'server-only'
import { db } from './db'
import { financeVals, type FinanceEvent, type Scenario } from './finance'
import { daysBetween, type PipelineEvent } from './pipeline'
import { initialsOf } from './format'
import { eventScope } from './scope'
import type { SessionUser } from './session'

/**
 * Loads the pipeline.
 *
 * The scope clause comes from src/lib/permissions.ts and goes into the query,
 * so an external promoter's rows never leave the database. Every figure is
 * computed by src/lib/finance.ts — nothing is recomputed here.
 */

const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`

export async function loadPipeline(user: SessionUser): Promise<PipelineEvent[]> {
  const events = await db.event.findMany({
    where: eventScope(user),
    include: {
      space: true,
      owner: true,
      artists: true,
      shifts: true,
      tasks: true,
      addons: true,
      actual: true,
    },
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

  // External promoter users, so a row can show who is coordinating from
  // outside the venue.
  const externals = await db.user.findMany({
    where: { role: 'PROMOTER', promoter: { not: null } },
    include: { person: true },
  })

  const now = new Date()

  return events.map((e) => {
    const k = monthKey(e.date)
    const orgShareHours = (orgByMonth.get(k) ?? 0) / (eventsByMonth.get(k) || 1)

    const fin: FinanceEvent = {
      dow: e.date.getDay(),
      std: e.std,
      door: e.door,
      mix: e.mix as [number, number, number, number],
      att: e.att as [number, number, number],
      scen: e.scen as Scenario,
      barHead: e.barHead,
      gear: e.gear,
      adv: e.adv,
      sound: e.sound,
      crew: e.crew,
      tok: e.tok,
      split: e.split,
      artists: e.artists.map((a) => ({
        status: a.status.toLowerCase() as 'enquired' | 'pencilled' | 'confirmed' | 'declined',
        low: a.low,
        high: a.high,
      })),
      shifts: e.shifts.map((s) => ({ hours: s.hours, assigned: s.personId !== null })),
      tasks: e.tasks.map((t) => ({ est: t.est, actual: t.actual })),
      addons: e.addons.map((a) => ({
        kind: a.kind.toLowerCase() as 'gear' | 'labour',
        cost: a.cost ?? undefined,
        hours: a.hours ?? undefined,
      })),
      orgShareHours,
    }
    const v = financeVals(fin)

    const ext = externals.find((u) => u.promoter && (e.promoter ?? '').includes(u.promoter))

    return {
      id: e.id,
      name: e.name,
      promoter: e.promoter ?? '',
      format: e.format,
      spaceName: e.space.name,
      concluded: e.concluded,
      stage: e.stage,
      daysToDoor: daysBetween(now, e.date),
      daysInStage: daysBetween(e.stageEnteredAt, now),
      riskNote: e.riskNote,
      riskKind: e.riskKind === 'STOP' ? 'stop' : 'warn',
      ownerInitials: e.owner?.initials ?? null,
      ownerName: e.owner?.name ?? null,
      // The prototype accents exactly one avatar: the coordinator's.
      ownerAccent: e.owner?.initials === 'MT',
      extCoordInitials: ext ? (ext.person?.initials ?? initialsOf(ext.name ?? ext.email)) : null,
      extCoordName: ext?.name ?? ext?.person?.name ?? null,
      surplus: v.ours,
      actualTotal: e.actual ? e.actual.ticketRev + e.actual.barProfit : null,
      hours: v.hours,
      taskHours: e.tasks.map((t) => ({ team: t.name, hours: t.actual ?? t.est })),
      onSiteHours: e.shifts.filter((s) => s.personId).reduce((a, s) => a + s.hours, 0),
    } satisfies PipelineEvent
  })
}
