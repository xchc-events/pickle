import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { dateLabel, hrs } from './format'
import { dayPeriod, fitFor, shortfall, type FitTone } from './roster'
import { minutesOfDay } from './run-times'
import { PLANNED_HOUR_COST } from './finance'
import type { SessionUser } from './session'

/**
 * Loads Roster.
 *
 * The rules — what a shift is, who fits one — are in `roster.ts` and are
 * tested there. This is the part that reads the database, and the one thing
 * it does that is not obvious is work out how many hours each person is
 * already booked for *in the week of this event*, which is what their stated
 * cap is a cap on.
 */

/** Monday-to-Sunday around a date. Availability caps are weekly. */
function weekAround(d: Date): { from: Date; to: Date } {
  const from = new Date(d)
  const day = (from.getDay() + 6) % 7 // Monday = 0
  from.setDate(from.getDate() - day)
  from.setHours(0, 0, 0, 0)

  const to = new Date(from)
  to.setDate(to.getDate() + 7)
  return { from, to }
}

/**
 * Where a set-up or clean-up shift's call defaults to, once pack-in and
 * pack-out are set — in the same unit `Shift.start` stores: hours offset
 * from doors, negative before it. `fallback` is whatever `windowFor` in
 * src/lib/roster.ts already gives the role, unchanged when there is no pack
 * time to read, or for every other role, which this has no opinion on.
 *
 * Connor, 23 Sep 2026: "It would be good to have a beginning of the pack-in
 * time and the end of the pack-out." Set-up starts at pack-in; clean-up
 * *ends* at pack-out, so its start is worked back from pack-out by its own
 * length.
 */
export function crewCallStart(
  role: string,
  hours: number,
  fallback: number,
  doors: string | null,
  packIn: string | null,
  packOut: string | null,
): number {
  const doorsM = minutesOfDay(doors)
  if (doorsM === null) return fallback

  if (role === 'Set-up crew') {
    const packInM = minutesOfDay(packIn)
    // Pack-in is at or before doors (src/lib/run-times.ts), always the same
    // calendar day — no midnight to carry across, unlike pack-out below.
    return packInM === null ? fallback : (packInM - doorsM) / 60
  }

  if (role === 'Clean-up crew') {
    const packOutM = minutesOfDay(packOut)
    if (packOutM === null) return fallback
    // The first time that clock reading comes round again after doors open —
    // the same carry `runProblems` reads pack-out's own validity by.
    const fromDoors = packOutM > doorsM ? packOutM - doorsM : packOutM + 1440 - doorsM
    return fromDoors / 60 - hours
  }

  return fallback
}

/**
 * The five run times in order, labelled and printed exactly as the event
 * stores them, for the roster page's event header. Whichever are not
 * decided yet are left out rather than shown blank; empty when none are.
 */
export function fiveTimesLine(v: {
  packIn: string | null
  doors: string | null
  barClose: string | null
  allOut: string | null
  packOut: string | null
}): string {
  return [
    v.packIn ? `Pack-in ${v.packIn}` : null,
    v.doors ? `Doors ${v.doors}` : null,
    v.barClose ? `Bar close ${v.barClose}` : null,
    v.allOut ? `Everyone out ${v.allOut}` : null,
    v.packOut ? `Pack-out ${v.packOut}` : null,
  ]
    .filter((s): s is string => s !== null)
    .join(' · ')
}

export interface Candidate {
  personId: string
  name: string
  initials: string
  tone: FitTone
  why: string
  /** Hours already booked in this event's week. */
  booked: number
  cap: number
}

export interface RosterShift {
  id: string
  role: string
  hours: number
  start: number
  state: string
  asked: number
  personId: string | null
  personName: string | null
  personInitials: string | null
  /** Everyone who could take it, best fit first. */
  candidates: Candidate[]
}

export interface RosterQueueRow {
  id: string
  name: string
  date: string
  open: number
  total: number
  tone: 'good' | 'warn' | 'stop'
  note: string
}

export interface RosterEventView {
  id: string
  name: string
  date: string
  spaceName: string
  format: string
  shifts: RosterShift[]
  /** Total call, and what it costs planned at the contractor rate. */
  callHours: string
  callCost: number
  shortfall: string | null
  /** The five times in order, printed exactly as the event stores them —
   *  never parsed or recomputed here. Null while a time is not decided. */
  packIn: string | null
  doors: string | null
  barClose: string | null
  allOut: string | null
  packOut: string | null
}

export interface RosterLoad {
  queue: RosterQueueRow[]
  event: RosterEventView | null
}

export async function loadRoster(
  user: SessionUser,
  wantedId: string | undefined,
): Promise<RosterLoad> {
  // Every live event, confirmed or not. This used to start at Confirmed, so
  // nobody was asked to hold a night for a show that may not happen; since
  // each part of an event moves on its own, the venue decided (16 Sep 2026)
  // that crew need not wait for the booking. The Pipeline shows which
  // bookings are still unconfirmed.
  const events = await db.event.findMany({
    where: { AND: [{ concluded: false }, eventScope(user)] },
    orderBy: { date: 'asc' },
    select: { id: true, name: true, date: true, shifts: { select: { state: true } } },
    take: 30,
  })

  const queue: RosterQueueRow[] = events.map((e) => {
    const open = e.shifts.filter((s) => s.state === 'OPEN' || s.state === 'ASKED').length
    return {
      id: e.id,
      name: e.name,
      date: dateLabel(e.date),
      open,
      total: e.shifts.length,
      tone: open === 0 ? 'good' : open > 3 ? 'stop' : 'warn',
      note: open === 0 ? 'fully crewed' : `${open} unfilled`,
    }
  })

  const ids = events.map((e) => e.id)
  const chosen = wantedId && ids.includes(wantedId) ? wantedId : (ids[0] ?? null)
  if (!chosen) return { queue, event: null }

  const row = await db.event.findUniqueOrThrow({
    where: { id: chosen },
    include: {
      space: { select: { name: true } },
      shifts: {
        orderBy: [{ start: 'asc' }, { role: 'asc' }],
        include: { person: { select: { id: true, name: true, initials: true } } },
      },
    },
  })

  const people = await db.person.findMany({
    where: { active: true },
    select: { id: true, name: true, initials: true, availability: true },
    orderBy: { name: 'asc' },
  })

  // What each person is already booked for in this event's week — the thing
  // their stated cap is a cap on. Counted across every event, not just this
  // one: a cap is a cap on their week, not on one show.
  const { from, to } = weekAround(row.date)
  const booked = await db.shift.groupBy({
    by: ['personId'],
    where: { personId: { not: null }, event: { date: { gte: from, lt: to } } },
    _sum: { hours: true },
  })
  const bookedBy = new Map(booked.map((b) => [b.personId!, b._sum.hours ?? 0]))

  const slot = dayPeriod(row.date)

  const shifts: RosterShift[] = row.shifts.map((s) => ({
    id: s.id,
    role: s.role,
    hours: s.hours,
    start: s.start,
    state: s.state,
    asked: s.asked,
    personId: s.personId,
    personName: s.person?.name ?? null,
    personInitials: s.person?.initials ?? null,
    candidates: people
      .map((p): Candidate => {
        const avail = p.availability ?? { weekly: 0, volunteer: 0, yes: [], no: [] }
        // The person already on this shift is not double-booked by it.
        const already = bookedBy.get(p.id) ?? 0
        const own = p.id === s.personId ? s.hours : 0
        const fit = fitFor(avail, slot, already - own, s.hours)

        return {
          personId: p.id,
          name: p.name,
          initials: p.initials,
          tone: fit.tone,
          why: fit.why,
          booked: already,
          cap: avail.weekly + avail.volunteer,
        }
      })
      // Keen first, then no view, then over-cap. A stated no is dropped
      // entirely rather than shown greyed out: offering somebody who told us
      // they cannot is how availability stops being believed.
      .filter((c) => c.tone !== 'stop')
      .sort((a, b) => rank(a.tone) - rank(b.tone) || a.name.localeCompare(b.name)),
  }))

  const callHours = shifts.reduce((n, s) => n + s.hours, 0)

  return {
    queue,
    event: {
      id: row.id,
      name: row.name,
      date: dateLabel(row.date),
      spaceName: row.space.name,
      format: row.format,
      shifts,
      callHours: hrs(callHours),
      callCost: callHours * PLANNED_HOUR_COST,
      shortfall: shortfall(shifts),
      packIn: row.packIn,
      doors: row.doors,
      barClose: row.barClose,
      allOut: row.allOut,
      packOut: row.packOut,
    },
  }
}

const rank = (t: FitTone): number => (t === 'good' ? 0 : t === 'plain' ? 1 : 2)
