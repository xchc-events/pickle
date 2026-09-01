'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
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
    include: { hourEntry: { select: { id: true } } },
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
    shift.hourEntry
      ? db.hourEntry.update({
          where: { id: shift.hourEntry.id },
          data: { personId: person.id, hours: shift.hours, eventId: id },
        })
      : db.hourEntry.create({
          data: {
            personId: person.id,
            eventId: id,
            shiftId: shift.id,
            hours: shift.hours,
            note: shift.role,
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
