import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { dateLabel, hrs, money } from './format'
import { apportion, costOf, monthKey, monthLabel } from './hours'
import type { Prisma } from '@/generated/prisma/client'
import type { SessionUser } from './session'

/**
 * Loads Hours.
 *
 * The rules are in `hours.ts` and tested there. What this file adds is the
 * one join the module exists to make: rostered shifts and typed-in work are
 * the *same* record, so the timesheet and the roster cannot disagree. There is
 * no second table of worked hours to reconcile — `HourEntry` is it, and the
 * roster writes to it directly.
 *
 * **Every total here is an aggregate, not a sum over a fetched page.** A page
 * of rows has to be capped, and a capped list silently under-reports the
 * moment the venue has a busy year — which on a page of wage figures would be
 * worse than showing nothing. The only capped query is the list of one
 * person's own lines, which is a list and reads like one.
 */

export interface HourLine {
  id: string
  hoursLabel: string
  cost: string
  role: string
  note: string | null
  where: string
  kind: 'onSite' | 'offSite' | 'org'
  when: string
  /** True for a row the roster wrote. Those are not editable here. */
  fromRoster: boolean
}

export interface MonthRow {
  key: string
  label: string
  orgHoursLabel: string
  orgCost: string
  events: number
  perEvent: string
  roles: string
  width: number
}

export interface EventHours {
  id: string
  name: string
  date: string
  onSite: string
  offSite: string
  org: string
  total: string
  cost: string
  heavy: boolean
}

export interface PersonHours {
  personId: string
  name: string
  initials: string
  hoursLabel: string
  cost: string
  width: number
  isMe: boolean
}

export interface HoursLoad {
  who: { personId: string; name: string; isMe: boolean } | null
  mine: HourLine[]
  mineTotal: string
  mineCost: string
  tiles: { label: string; value: string; sub: string; accent?: boolean }[]
  months: MonthRow[]
  events: EventHours[]
  people: PersonHours[]
  eventOptions: { id: string; label: string }[]
  monthOptions: { key: string; label: string; events: number }[]
}

const sum = (n: number | null | undefined) => n ?? 0

export async function loadHours(
  user: SessionUser,
  wantedPersonId: string | undefined,
): Promise<HoursLoad> {
  const events = await db.event.findMany({
    where: eventScope(user),
    orderBy: { date: 'desc' },
    select: { id: true, name: true, date: true, tasks: { select: { est: true, actual: true } } },
    take: 60,
  })
  const eventIds = events.map((e) => e.id)

  // An external promoter sees only hours on their own events — and never the
  // org-wide pool, which is the venue's own business.
  const scope: Prisma.HourEntryWhereInput = user.external ? { eventId: { in: eventIds } } : {}

  const people = await db.person.findMany({
    where: { active: true },
    select: { id: true, name: true, initials: true },
    orderBy: { name: 'asc' },
  })

  const chosenId =
    wantedPersonId && people.some((p) => p.id === wantedPersonId)
      ? wantedPersonId
      : (user.personId ?? people[0]?.id ?? null)
  const chosen = people.find((p) => p.id === chosenId) ?? null

  // --- totals, as aggregates ----------------------------------------------

  const [onSiteAgg, offSiteAgg, orgAgg, byPersonAgg] = await Promise.all([
    db.hourEntry.aggregate({ where: { ...scope, shiftId: { not: null } }, _sum: { hours: true } }),
    db.hourEntry.aggregate({
      where: { ...scope, shiftId: null, eventId: { not: null } },
      _sum: { hours: true },
    }),
    user.external
      ? Promise.resolve({ _sum: { hours: 0 } })
      : db.hourEntry.aggregate({ where: { eventId: null }, _sum: { hours: true } }),
    db.hourEntry.groupBy({ by: ['personId'], where: scope, _sum: { hours: true } }),
  ])

  const onSiteTotal = sum(onSiteAgg._sum.hours)
  const offSiteTotal = sum(offSiteAgg._sum.hours)
  const orgTotal = sum(orgAgg._sum.hours)
  const loggedTotal = onSiteTotal + offSiteTotal + orgTotal

  // --- that person's own lines (the one capped query, because it is a list) ---

  const mineRows = chosenId
    ? await db.hourEntry.findMany({
        where: { ...scope, personId: chosenId },
        include: { event: { select: { name: true } } },
        orderBy: { workedOn: 'desc' },
        take: 100,
      })
    : []

  const mineAgg = chosenId
    ? await db.hourEntry.aggregate({
        where: { ...scope, personId: chosenId },
        _sum: { hours: true },
      })
    : { _sum: { hours: 0 } }
  const mineHours = sum(mineAgg._sum.hours)

  const mine: HourLine[] = mineRows.map((e) => ({
    id: e.id,
    hoursLabel: hrs(e.hours),
    cost: money(costOf(e.hours)),
    role: e.role ?? 'Work',
    note: e.note,
    where: e.event ? e.event.name : `org-wide · ${monthLabel(monthKey(e.workedOn))}`,
    kind: e.shiftId ? 'onSite' : e.eventId ? 'offSite' : 'org',
    when: dateLabel(e.workedOn),
    fromRoster: e.shiftId !== null,
  }))

  // --- the monthly org-wide pool ------------------------------------------

  const eventsByMonth = new Map<string, number>()
  for (const e of events) {
    const k = monthKey(e.date)
    eventsByMonth.set(k, (eventsByMonth.get(k) ?? 0) + 1)
  }

  // Grouped by role, then bucketed by month here — Prisma cannot group by a
  // month expression, and the org-wide set is small enough to bucket in
  // memory where the shift-backed set would not be.
  const orgRows = user.external
    ? []
    : await db.hourEntry.findMany({
        where: { eventId: null },
        select: { hours: true, role: true, workedOn: true },
      })

  const orgByMonth = new Map<string, { hours: number; roles: Map<string, number> }>()
  for (const r of orgRows) {
    const k = monthKey(r.workedOn)
    const bucket = orgByMonth.get(k) ?? { hours: 0, roles: new Map<string, number>() }
    bucket.hours += r.hours
    const role = r.role ?? 'Unattributed'
    bucket.roles.set(role, (bucket.roles.get(role) ?? 0) + r.hours)
    orgByMonth.set(k, bucket)
  }

  const monthKeys = [...new Set([...eventsByMonth.keys(), ...orgByMonth.keys()])].sort().reverse()
  const busiest = Math.max(1, ...[...orgByMonth.values()].map((b) => b.hours))

  const months: MonthRow[] = monthKeys.map((k) => {
    const bucket = orgByMonth.get(k)
    const orgHours = bucket?.hours ?? 0
    const n = eventsByMonth.get(k) ?? 0
    const per = apportion(orgHours, n)

    return {
      key: k,
      label: monthLabel(k),
      orgHoursLabel: hrs(orgHours),
      orgCost: money(costOf(orgHours)),
      events: n,
      perEvent: `${hrs(per)} · ${money(costOf(per))}`,
      roles: bucket
        ? [...bucket.roles.entries()].map(([r, h]) => `${r} ${hrs(h)}`).join(' · ')
        : 'nothing logged org-wide this month',
      width: Math.min(100, Math.round((orgHours / busiest) * 100)),
    }
  })

  // --- per event, aggregated --------------------------------------------

  const [onSiteByEvent, offSiteByEvent] = await Promise.all([
    db.hourEntry.groupBy({
      by: ['eventId'],
      where: { eventId: { in: eventIds }, shiftId: { not: null } },
      _sum: { hours: true },
    }),
    db.hourEntry.groupBy({
      by: ['eventId'],
      where: { eventId: { in: eventIds }, shiftId: null },
      _sum: { hours: true },
    }),
  ])

  const onSiteMap = new Map(onSiteByEvent.map((r) => [r.eventId!, sum(r._sum.hours)]))
  const offSiteMap = new Map(offSiteByEvent.map((r) => [r.eventId!, sum(r._sum.hours)]))

  const eventRows: EventHours[] = events.map((ev) => {
    const k = monthKey(ev.date)
    const onSite = onSiteMap.get(ev.id) ?? 0
    const logged = offSiteMap.get(ev.id) ?? 0

    // Task hours are the venue's own estimate of off-site work and stand in
    // until somebody logs the real thing. Actual wins where it exists — the
    // same rule finance.ts applies, and it has to be the same rule.
    const taskHours = ev.tasks.reduce((n, t) => n + (t.actual ?? t.est), 0)
    const offSite = Math.max(logged, taskHours)
    const orgShare = apportion(orgByMonth.get(k)?.hours ?? 0, eventsByMonth.get(k) ?? 0)
    const total = onSite + offSite + orgShare

    return {
      id: ev.id,
      name: ev.name,
      date: dateLabel(ev.date),
      onSite: hrs(onSite),
      offSite: hrs(offSite),
      org: hrs(orgShare),
      total: hrs(total),
      cost: money(costOf(total)),
      heavy: total > 60,
    }
  })

  // --- people --------------------------------------------------------------

  const peak = Math.max(1, ...byPersonAgg.map((r) => sum(r._sum.hours)))

  return {
    who: chosen
      ? { personId: chosen.id, name: chosen.name, isMe: chosen.id === user.personId }
      : null,
    mine,
    mineTotal: hrs(mineHours),
    mineCost: money(costOf(mineHours)),
    tiles: [
      {
        label: 'Logged, all sources',
        value: hrs(loggedTotal),
        sub: `${money(costOf(loggedTotal))} loaded`,
      },
      {
        label: 'Org-wide, not event work',
        value: hrs(orgTotal),
        sub: `${Math.round((orgTotal / Math.max(loggedTotal, 1)) * 100)}% of everything logged`,
        accent: true,
      },
      {
        label: 'On-site rostered hours',
        value: hrs(onSiteTotal),
        sub: 'from the roster, not typed twice',
      },
      {
        label: 'People logging time',
        value: String(byPersonAgg.length),
        sub: `of ${people.length} on the books`,
      },
    ],
    months,
    events: eventRows,
    people: byPersonAgg
      .map((r): PersonHours => {
        const p = people.find((x) => x.id === r.personId)
        const hours = sum(r._sum.hours)
        return {
          personId: r.personId,
          name: p?.name ?? 'Somebody who has left',
          initials: p?.initials ?? '—',
          hoursLabel: hrs(hours),
          cost: money(costOf(hours)),
          width: Math.min(100, Math.round((hours / peak) * 100)),
          isMe: r.personId === chosenId,
        }
      })
      .sort((a, b) => b.width - a.width),
    eventOptions: events
      .slice()
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((e) => ({ id: e.id, label: `${e.name} · ${dateLabel(e.date)}` })),
    monthOptions: monthKeys.map((k) => ({
      key: k,
      label: monthLabel(k),
      events: eventsByMonth.get(k) ?? 0,
    })),
  }
}
