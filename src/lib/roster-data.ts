import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { dateLabel, hrs } from './format'
import { dayPeriod, fitFor, shiftPlan, shortfall, type FitTone } from './roster'
import { minutesOfDay } from './run-times'
import { PLANNED_HOUR_COST } from './finance'
import { capacityOf, type SpaceCapacity } from './ticketing'
import { readSales } from './gather'
import { isLate } from './event-record'
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

/**
 * The `<input type="time">` value for a clock-of-night reading — doors plus
 * an offset in hours, signed the same way `Shift.start` and `crewCallStart`
 * both are. '' when doors is not decided yet, the same case `crewCallStart`
 * falls back on — there is nothing to offset from.
 */
export function clockInputFor(doors: string | null, offsetHours: number): string {
  const doorsM = minutesOfDay(doors)
  if (doorsM === null) return ''

  const totalMin = Math.round(doorsM + offsetHours * 60)
  const wrapped = ((totalMin % 1440) + 1440) % 1440
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0')
  const mm = String(wrapped % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/**
 * The reverse of `clockInputFor`: the offset from doors, in hours, that a
 * clock-of-night reading represents.
 *
 * A bare clock reading cannot say which calendar day it falls on — "6:00pm"
 * is two hours before an 8pm doors time and twenty-two hours after it, and
 * both are the same clock face. `anchorHours` is the shift's own current
 * offset (its start, or its start plus its hours, for the end), so nudging a
 * time by an hour or two — the realistic edit — always resolves to the
 * nearby reading rather than jumping a full day; left untouched, the same
 * clock string round-trips to the exact offset it came from. Null when doors
 * or the reading itself is not a real time.
 */
export function offsetFromClock(
  clockLabel: string | null,
  doors: string | null,
  anchorHours: number,
): number | null {
  const doorsM = minutesOfDay(doors)
  const clockM = minutesOfDay(clockLabel)
  if (doorsM === null || clockM === null) return null

  const base = (clockM - doorsM) / 60
  const k = Math.round((anchorHours - base) / 24)
  // Rounded to the minute: every offset in this codebase is derived from
  // whole-minute clock readings, and this keeps float noise out of `Shift.hours`.
  return Math.round((base + 24 * k) * 60) / 60
}

/**
 * The sales strip's four figures: what has sold, the likely turnout the
 * event is staffed to, what the room holds, and how many shifts the
 * standard plan wants at that turnout. A pure composition over exactly the
 * sources named for it — `readSales`, `Event.att[1]`, `capacityOf`,
 * `shiftPlan` — factored out of `loadRoster`'s database read so it is
 * provable without one.
 */
export function salesStripFor(event: {
  sold: number
  updatedAt: Date
  att: readonly number[]
  format: string
  kind: string
  barClose: string | null
  space: SpaceCapacity
}): RosterSales {
  return {
    sold: readSales(event).sold,
    likely: event.att[1] ?? 0,
    capacity: capacityOf(event.space, event.format),
    planned: shiftPlan({
      space: event.space,
      format: event.format,
      kind: event.kind,
      att: event.att,
      lateBar: isLate(event.barClose),
    }).length,
  }
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
  /** For the contact popover on the shift row's avatar. Null when there is
   *  no person, or the person has none on file. */
  personEmail: string | null
  /** From the linked User, where the person has one — `Person` itself
   *  carries no phone number. */
  personPhone: string | null
  /** Everyone who could take it, best fit first. */
  candidates: Candidate[]
  /** This shift's start and end as `<input type="time">` values, derived
   *  from doors and the offset. '' when doors is not decided yet. */
  startInput: string
  endInput: string
}

export interface RosterSales {
  /** Paid tickets sold so far, from Gather.rsvp (`readSales`). */
  sold: number
  /** The likely-turnout scenario the event is staffed to (`Event.att[1]`). */
  likely: number
  /** What the room holds at this event's layout (`capacityOf`). */
  capacity: number
  /** How many shifts the standard plan wants at that turnout
   *  (`shiftPlan(event).length`). */
  planned: number
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
  /** Sold, likely turnout, capacity and the standard plan's shift count —
   *  read-only context for whether the roster still needs everyone on it. */
  sales: RosterSales
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
    // Not yet truly filled: OPEN and ASKED, same as before, plus OFFERED —
    // nobody has said yes until a shift is ASSIGNED, and the hours are not
    // booked until then either. See shortfall() in src/lib/roster.ts, which
    // this mirrors for the same reason.
    const open = e.shifts.filter((s) => s.state !== 'ASSIGNED' && s.state !== 'DONE').length
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
      space: { select: { name: true, capacity: true, seatedCapacity: true } },
      shifts: {
        orderBy: [{ start: 'asc' }, { role: 'asc' }],
        include: {
          person: {
            select: {
              id: true,
              name: true,
              initials: true,
              email: true,
              user: { select: { phone: true } },
            },
          },
        },
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
    personEmail: s.person?.email ?? null,
    personPhone: s.person?.user?.phone ?? null,
    startInput: clockInputFor(row.doors, s.start),
    endInput: clockInputFor(row.doors, s.start + s.hours),
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
      sales: salesStripFor(row),
    },
  }
}

const rank = (t: FitTone): number => (t === 'good' ? 0 : t === 'plain' ? 1 : 2)
