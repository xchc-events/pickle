'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { linkBase } from '@/lib/auth-rules'
import { sendMail } from '@/lib/email'
import { dateLabel } from '@/lib/format'
import { hashToken, mintToken } from '@/lib/grants'
import { requireEvent, requireModule } from '@/lib/permissions'
import { callTimes, offsetFromClock } from '@/lib/roster-data'
import { clockFromInput } from '@/lib/run-times'
import { shiftOfferEmail } from '@/lib/shift-offer-email'
import { confirmOfferedShift, declineOfferedShift } from '@/lib/shift-offers-data'
import { shiftOfferExpiryFrom } from '@/lib/shift-offers'
import { said, type Said } from '@/lib/toast'

/**
 * Roster's mutations.
 *
 * The whole module turns on one rule: **confirming a shift creates the
 * hours.**
 *
 * That is the product's central claim applied here — one record of an hour.
 * A roster that recorded who was on, and a timesheet that recorded what they
 * worked, would be two records of the same hour and would disagree within a
 * week. So there is no path in this file, or in `src/lib/shift-offers-data.ts`
 * which `confirmOffer` and `declineOffer` below hand off to, that changes a
 * shift's person without changing its `HourEntry` in the same breath, and
 * the two are done in one transaction so they cannot half-happen.
 *
 * Since R6 (23 Sep 2026), picking somebody — `offerShift`, bound to
 * `ShiftPicker` — only offers them the shift; no hours exist until it is
 * confirmed, by the duty manager on the spot, by the person themself on
 * Home, or through an emailed link. Declining, the same three ways, clears
 * the person and reopens the shift, booking nothing.
 *
 * `Shift.hourEntry` is a one-to-one, which is what makes this enforceable
 * rather than merely intended.
 *
 * The same rule holds for reshaping a shift, not just filling it: retiming
 * moves the linked hour entry's hours in the same transaction below,
 * deleting a shift takes its hours with it, and duplicating creates a shift
 * with no hours to keep in step because it has nobody on it yet.
 */

/**
 * Picking somebody for a shift.
 *
 * Since R6 this no longer books the hours on the spot: it offers the shift.
 * "Sometimes the person will be chatting with the crew member and chucking
 * them on right then; other times they're assigning people and hoping they
 * take those ones" (Connor) — either way starts here, as OFFERED with no
 * hour entry, and `confirmOffer` is what actually books the hours, whether
 * that happens a second later or a week later. See `src/lib/shift-offers-data.ts`.
 */
export async function offerShift(
  eventId: string,
  shiftId: string,
  personId: string,
): Promise<Said> {
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
      `${shift.role}’s hours are already paid — that cannot be undone by picking somebody else; Finance reverses the payment first.`,
      'stop',
    )
  }

  // Clearing it, whether it was open, offered or assigned. Any hours it
  // carried go with it — an offer that was never confirmed never earned them,
  // and the paid check above already ruled out silently erasing a wage that
  // did go out.
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
      shift.hourEntry
        ? `${shift.role} is open again, and the ${shift.hours}h came off the event with it.`
        : `${shift.role} is open again.`,
      'warn',
    )
  }

  const person = await db.person.findFirst({
    where: { id: personId, active: true },
    select: { id: true, name: true },
  })
  if (!person) return said('That is not somebody who works here.', 'stop')

  await db.$transaction([
    // No hours yet, whoever held it before — an offer starts clean.
    ...(shift.hourEntry ? [db.hourEntry.delete({ where: { id: shift.hourEntry.id } })] : []),
    db.shift.update({
      where: { id: shift.id },
      data: { personId: person.id, state: 'OFFERED' },
    }),
  ])

  await record(id, user, `offered ${shift.role} to ${person.name}`)

  refresh()
  return said(
    `${shift.role} is offered to ${person.name}. Confirm it now if they said yes in the room, or email them the offer.`,
  )
}

/**
 * The duty manager confirming in the room — "they said yes in the room".
 * Anyone who can open Roster and reaches this event may confirm any of its
 * offers; unlike Home's own confirm, it is not gated on being the person
 * the shift is offered to.
 */
export async function confirmOffer(eventId: string, shiftId: string): Promise<Said> {
  const { user } = await requireModule('roster')
  if (user.external) return said('Not something an external account can do.', 'stop')
  const id = await requireEvent(user, eventId)

  const shift = await db.shift.findFirst({
    where: { id: shiftId, eventId: id },
    select: { id: true },
  })
  if (!shift) return said('That shift is not on this event.', 'stop')

  const out = await confirmOfferedShift(shiftId, { personId: user.personId, who: user.initials })
  refresh()
  return out
}

/** The duty manager recording that somebody said no, on the shift's behalf. */
export async function declineOffer(eventId: string, shiftId: string): Promise<Said> {
  const { user } = await requireModule('roster')
  if (user.external) return said('Not something an external account can do.', 'stop')
  const id = await requireEvent(user, eventId)

  const shift = await db.shift.findFirst({
    where: { id: shiftId, eventId: id },
    select: { id: true },
  })
  if (!shift) return said('That shift is not on this event.', 'stop')

  const out = await declineOfferedShift(shiftId, { personId: user.personId, who: user.initials })
  refresh()
  return out
}

/**
 * Email the offer: a `ShiftOffer` row good for one reply, on the
 * `AccessGrant` pattern — 32 random bytes, only the SHA-256 kept, a page
 * that needs no sign-in. Refuses when the person has no email on file,
 * naming them, since there is nowhere to send it.
 */
export async function emailOffer(eventId: string, shiftId: string): Promise<Said> {
  const { user } = await requireModule('roster')
  if (user.external) return said('Not something an external account can do.', 'stop')
  const id = await requireEvent(user, eventId)

  const shift = await db.shift.findFirst({
    where: { id: shiftId, eventId: id },
    include: {
      person: { select: { id: true, name: true, email: true } },
      event: { select: { name: true, date: true, doors: true } },
    },
  })
  if (!shift) return said('That shift is not on this event.', 'stop')
  if (shift.state !== 'OFFERED' || !shift.person) {
    return said('Pick somebody for this shift before emailing an offer.', 'stop')
  }
  if (!shift.person.email) {
    return said(`${shift.person.name} has no email on file — call or text them instead.`, 'stop')
  }

  const base = linkBase(process.env.AUTH_URL, process.env.NODE_ENV)
  if (!base) {
    return said('The app’s own address is not configured, so no link can be sent.', 'stop')
  }

  const token = mintToken()
  await db.shiftOffer.create({
    data: {
      shiftId: shift.id,
      personId: shift.person.id,
      tokenHash: hashToken(token),
      expires: shiftOfferExpiryFrom(new Date()),
    },
  })

  await sendMail(
    shift.person.email,
    shiftOfferEmail({
      personName: shift.person.name,
      role: shift.role,
      eventName: shift.event.name,
      when: dateLabel(shift.event.date),
      times: callTimes(shift.event.doors, shift.start, shift.hours),
      hours: shift.hours,
      url: `${base}/s/${token}`,
    }),
  )

  await record(id, user, `emailed the offer for ${shift.role} to ${shift.person.name}`)
  refresh()
  return said(
    `Offer emailed to ${shift.person.name}. It stops working in 7 days if nobody answers it.`,
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
  if (shift.state === 'OFFERED') {
    return said('Somebody is already offered this shift — confirm or decline that first.', 'warn')
  }
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
 * when `confirmOfferedShift` created it. If nobody has touched it since — it still
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
