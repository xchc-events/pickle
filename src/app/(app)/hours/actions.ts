'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import { ORG_ROLES, TEAMS, costOf } from '@/lib/hours'
import { money } from '@/lib/format'
import { said, type Said } from '@/lib/toast'

/**
 * Hours' mutations.
 *
 * Two rules run through this file:
 *
 *  - **You log your own hours.** `personId` comes from the session, never from
 *    the form. Somebody's timesheet is a claim they make about their own week,
 *    and a product where one person can add hours under another person's name
 *    is one where the profit share stops being arguable.
 *  - **A roster-written row cannot be edited here.** Those rows belong to a
 *    shift; changing the hours without changing the shift would put the
 *    roster and the timesheet into disagreement, which is the exact thing
 *    "one record of an hour" exists to prevent. Change the shift instead.
 */

const MAX_HOURS = 24

export async function logHours(form: FormData): Promise<Said> {
  const { user } = await requireModule('hours')

  if (!user.personId) {
    return said(
      'This account is not linked to a person, so there is nowhere to put the hours. An administrator can link it in Admin.',
      'stop',
    )
  }

  const hours = Number(form.get('hours'))
  const role = String(form.get('role') ?? '')
  const kind = String(form.get('kind') ?? 'event')
  const note = String(form.get('note') ?? '').trim() || null
  const eventId = String(form.get('eventId') ?? '') || null
  const month = String(form.get('month') ?? '')

  if (!Number.isFinite(hours) || hours <= 0) {
    return said('Hours have to be a number above zero.', 'stop')
  }
  if (hours > MAX_HOURS) {
    return said(
      `${hours}h in one entry is longer than a day. Split it across the days worked.`,
      'stop',
    )
  }

  const allowed: readonly string[] = kind === 'org' ? ORG_ROLES : TEAMS
  if (!allowed.includes(role)) return said('That is not one of the roles.', 'stop')

  // The day the work happened, not the day it is being typed. An org-wide
  // entry is pooled by this, so getting it wrong lands the money on the wrong
  // month's events.
  let workedOn = new Date()
  if (kind === 'org') {
    const m = /^(\d{4})-(\d{2})$/.exec(month)
    if (!m) return said('Pick the month the work was in.', 'stop')
    // Mid-month, so a timezone shift cannot roll it into a neighbour.
    workedOn = new Date(Number(m[1]), Number(m[2]) - 1, 15)
  }

  if (kind === 'event') {
    if (!eventId) return said('Pick the event the work was for.', 'stop')
    // Scoped, so an external promoter cannot log time against somebody
    // else's show. Denial is a 404 inside requireEvent.
    await requireEvent(user, eventId)
  }

  const entry = await db.hourEntry.create({
    data: {
      personId: user.personId,
      eventId: kind === 'event' ? eventId : null,
      hours,
      role,
      note,
      workedOn,
    },
  })

  if (entry.eventId) {
    await record(entry.eventId, user, `logged ${hours}h of ${role.toLowerCase()}`)
  }

  refresh()
  return said(
    kind === 'event'
      ? `${hours}h logged. ${money(costOf(hours))} is now against that event, and its surplus is that much smaller.`
      : `${hours}h logged org-wide. It spreads across the events in that month — see the pool below.`,
  )
}

/**
 * Remove an entry.
 *
 * Only your own, and never one the roster wrote. A shift-backed row is
 * removed by unassigning the shift, which takes the hours with it — see
 * src/app/(app)/roster/actions.ts.
 */
export async function removeEntry(entryId: string): Promise<Said> {
  const { user } = await requireModule('hours')

  const entry = await db.hourEntry.findUnique({
    where: { id: entryId },
    select: { id: true, personId: true, shiftId: true, hours: true, eventId: true, role: true },
  })
  if (!entry) return said('That entry is gone already.', 'warn')

  if (entry.personId !== user.personId) {
    return said('You can only remove your own hours.', 'stop')
  }

  if (entry.shiftId) {
    return said(
      'That came from the roster. Take the shift off them there and the hours go with it — otherwise the roster and the timesheet would disagree.',
      'stop',
    )
  }

  await db.hourEntry.delete({ where: { id: entry.id } })

  if (entry.eventId) {
    await record(
      entry.eventId,
      user,
      `removed ${entry.hours}h of ${(entry.role ?? 'work').toLowerCase()}`,
    )
  }

  refresh()
  return said(`${entry.hours}h removed. The event's surplus goes back up by that much.`, 'warn')
}
