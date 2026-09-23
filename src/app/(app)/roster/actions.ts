'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import { offsetFromClock } from '@/lib/roster-data'
import { clockFromInput } from '@/lib/run-times'
import { said, type Said } from '@/lib/toast'

/**
 * Roster's mutations.
 *
 * The whole module turns on one rule: **assigning a shift creates the hours.**
 *
 * That is the product's central claim applied here — one record of an hour.
 * A roster that recorded who was on, and a timesheet that recorded what they
 * worked, would be two records of the same hour and would disagree within a
 * week. So there is no path in this file that changes a shift's person
 * without changing its `HourEntry` in the same breath, and the two are done
 * in one transaction so they cannot half-happen.
 *
 * `Shift.hourEntry` is a one-to-one, which is what makes this enforceable
 * rather than merely intended.
 *
 * The same rule holds for reshaping a shift, not just filling it: retiming
 * moves the linked hour entry's hours in the same transaction below,
 * deleting a shift takes its hours with it, and duplicating creates a shift
 * with no hours to keep in step because it has nobody on it yet.
 */

export async function assignShift(
  eventId: string,
  shiftId: string,
  personId: string,
): Promise<Said> {
  const { user } = await requireModule('roster')
  const id = await requireEvent(user, eventId)

  const shift = await db.shift.findFirst({
    where: { id: shiftId, eventId: id },
    include: { hourEntry: { select: { id: true } }, event: { select: { date: true } } },
  })
  if (!shift) return said('That shift is not on this event.', 'stop')

  // Clearing the assignment. The hours go with it — they were never worked.
  if (!personId) {
    await db.$transaction([
      ...(shift.hourEntry ? [db.hourEntry.delete({ where: { id: shift.hourEntry.id } })] : []),
      db.shift.update({
        where: { id: shift.id },
        data: { personId: null, state: 'OPEN' },
      }),
    ])

    await record(id, user, `took ${shift.role} back to open`)
    refresh()
    return said(
      `${shift.role} is open again, and the ${shift.hours}h came off the event with it.`,
      'warn',
    )
  }

  const person = await db.person.findFirst({
    where: { id: personId, active: true },
    select: { id: true, name: true },
  })
  if (!person) return said('That is not somebody who works here.', 'stop')

  await db.$transaction([
    db.shift.update({
      where: { id: shift.id },
      data: { personId: person.id, state: 'ASSIGNED' },
    }),
    // Upsert rather than create: reassigning a shift moves the hours to the
    // new person instead of leaving the old person's behind.
    //
    // `workedOn` is the night, on both paths. Left to the column's default it
    // is the moment of assigning, so a shift filled in September for an October
    // night reads as September's work wherever hours are shown by month. The
    // update writes it too, which puts right an entry made before this did.
    shift.hourEntry
      ? db.hourEntry.update({
          where: { id: shift.hourEntry.id },
          data: {
            personId: person.id,
            hours: shift.hours,
            eventId: id,
            workedOn: shift.event.date,
          },
        })
      : db.hourEntry.create({
          data: {
            personId: person.id,
            eventId: id,
            shiftId: shift.id,
            hours: shift.hours,
            note: shift.role,
            workedOn: shift.event.date,
          },
        }),
  ])

  await record(id, user, `${person.name} on ${shift.role}`)

  refresh()
  return said(
    `${person.name} is on ${shift.role}. The ${shift.hours}h are already against the event — nobody types them in again.`,
  )
}

/**
 * Ask somebody without assigning them.
 *
 * A shift that has been asked about is not a shift that is covered, and the
 * count of asks is on the record because "we asked four people and nobody
 * could do it" is the thing a coordinator needs to be able to say.
 */
export async function askAgain(eventId: string, shiftId: string): Promise<Said> {
  const { user } = await requireModule('roster')
  const id = await requireEvent(user, eventId)

  const shift = await db.shift.findFirst({
    where: { id: shiftId, eventId: id },
    select: { id: true, role: true, asked: true, state: true },
  })
  if (!shift) return said('That shift is not on this event.', 'stop')
  if (shift.state === 'ASSIGNED' || shift.state === 'DONE') {
    return said('That shift is already covered.', 'warn')
  }

  const asked = shift.asked + 1
  await db.shift.update({ where: { id: shift.id }, data: { asked, state: 'ASKED' } })
  await record(id, user, `asked around again about ${shift.role}`)

  refresh()
  return said(
    asked >= 5
      ? `${asked} asks on ${shift.role} and still open. That is worth raising rather than asking a sixth time.`
      : `Marked as asked — ${asked} so far. Still counts as unfilled until somebody says yes.`,
    asked >= 5 ? 'stop' : 'warn',
  )
}

/**
 * Rename a shift's role.
 *
 * Touches the shift's own start, hours, person and state not at all — those
 * are exactly as they were. Retiming lives in `retimeShift` below; a single
 * save that changes both calls each in turn.
 *
 * The linked hour entry's `note` carries the role name too, written once
 * when `assignShift` created it. If nobody has touched it since — it still
 * reads exactly the old role — the rename carries it forward in the same
 * transaction, so Hours does not go on showing a name the roster dropped. A
 * note somebody has hand-edited (to say who they're covering for, say) is
 * left alone: that wording is theirs, not a copy of the role.
 */
export async function renameShift(eventId: string, shiftId: string, role: string): Promise<Said> {
  const { user } = await requireModule('roster')
  if (user.external) return said('Not something an external account can do.', 'stop')
  const id = await requireEvent(user, eventId)

  const name = role.trim()
  if (!name) return said('A shift needs a role name.', 'stop')

  const shift = await db.shift.findFirst({
    where: { id: shiftId, eventId: id },
    include: { hourEntry: { select: { id: true, note: true } } },
  })
  if (!shift) return said('That shift is not on this event.', 'stop')
  if (name === shift.role) return said('Nothing changed.', 'warn')

  const followNote = shift.hourEntry != null && shift.hourEntry.note === shift.role

  await db.$transaction([
    db.shift.update({ where: { id: shift.id }, data: { role: name } }),
    ...(followNote
      ? [db.hourEntry.update({ where: { id: shift.hourEntry!.id }, data: { note: name } })]
      : []),
  ])
  await record(id, user, `renamed ${shift.role} to ${name}`)

  refresh()
  return said(`Renamed to ${name}.`)
}

/**
 * Move a shift's start and end, given as clock times on the night.
 *
 * Written back as `start` (offset from doors) and `hours`, since that is
 * what `shiftPlan` and the P&L read — never as clock strings, which is why
 * this is the only place that converts one to the other. The linked hour
 * entry's `hours` moves with it, in the same transaction, for the same
 * reason `assignShift` above keeps a shift and its hours from half-happening.
 */
export async function retimeShift(
  eventId: string,
  shiftId: string,
  input: { start: string; end: string },
): Promise<Said> {
  const { user } = await requireModule('roster')
  if (user.external) return said('Not something an external account can do.', 'stop')
  const id = await requireEvent(user, eventId)

  const shift = await db.shift.findFirst({
    where: { id: shiftId, eventId: id },
    include: {
      hourEntry: { select: { id: true, paid: true } },
      event: { select: { doors: true } },
    },
  })
  if (!shift) return said('That shift is not on this event.', 'stop')

  if (shift.hourEntry?.paid) {
    return said(
      `${shift.role}’s hours are already paid — a paid wage cannot be moved from the roster; Finance reverses a payment first.`,
      'stop',
    )
  }

  const startLabel = clockFromInput(input.start)
  const endLabel = clockFromInput(input.end)
  if (!startLabel || !endLabel) return said('That is not a time.', 'stop')

  // Anchored on the shift's own current offset — see offsetFromClock — so an
  // untouched field round-trips to the exact value it started at.
  const newStart = offsetFromClock(startLabel, shift.event.doors, shift.start)
  const newEnd = offsetFromClock(endLabel, shift.event.doors, shift.start + shift.hours)
  if (newStart === null || newEnd === null) {
    return said('Set doors on the event before editing shift times.', 'stop')
  }

  const newHours = Math.round((newEnd - newStart) * 60) / 60
  if (newHours <= 0) return said('The end cannot be before the start.', 'stop')

  await db.$transaction([
    db.shift.update({ where: { id: shift.id }, data: { start: newStart, hours: newHours } }),
    ...(shift.hourEntry
      ? [db.hourEntry.update({ where: { id: shift.hourEntry.id }, data: { hours: newHours } })]
      : []),
  ])

  await record(id, user, `changed ${shift.role}’s call to ${startLabel}–${endLabel}`)

  refresh()
  return said(`${shift.role} now runs ${startLabel}–${endLabel}.`)
}

/**
 * Add another shift the same as this one — same role, hours and call — but
 * open, with no person and no hour entry. Duplicating a set-up crew slot
 * five times makes five shifts to fill, not one person carrying five times
 * the hours.
 */
export async function duplicateShift(eventId: string, shiftId: string): Promise<Said> {
  const { user } = await requireModule('roster')
  if (user.external) return said('Not something an external account can do.', 'stop')
  const id = await requireEvent(user, eventId)

  const shift = await db.shift.findFirst({
    where: { id: shiftId, eventId: id },
    select: { role: true, hours: true, start: true },
  })
  if (!shift) return said('That shift is not on this event.', 'stop')

  await db.shift.create({
    data: { eventId: id, role: shift.role, hours: shift.hours, start: shift.start, state: 'OPEN' },
  })
  await record(id, user, `duplicated ${shift.role}`)

  refresh()
  return said(`Another ${shift.role} shift added, open.`)
}

/**
 * Remove a shift outright.
 *
 * Its hour entry goes with it — those hours were never worked — unless the
 * entry is already paid, in which case deleting the shift would quietly
 * erase a wage that has actually gone out. That refuses instead.
 */
export async function deleteShift(eventId: string, shiftId: string): Promise<Said> {
  const { user } = await requireModule('roster')
  if (user.external) return said('Not something an external account can do.', 'stop')
  const id = await requireEvent(user, eventId)

  const shift = await db.shift.findFirst({
    where: { id: shiftId, eventId: id },
    include: { hourEntry: { select: { id: true, paid: true } } },
  })
  if (!shift) return said('That shift is not on this event.', 'stop')

  if (shift.hourEntry?.paid) {
    return said(
      `${shift.role} is already paid — that cannot be undone by deleting the shift.`,
      'stop',
    )
  }

  await db.$transaction([
    ...(shift.hourEntry ? [db.hourEntry.delete({ where: { id: shift.hourEntry.id } })] : []),
    db.shift.delete({ where: { id: shift.id } }),
  ])
  await record(id, user, `deleted ${shift.role}`)

  refresh()
  return said(`${shift.role} deleted.`)
}
