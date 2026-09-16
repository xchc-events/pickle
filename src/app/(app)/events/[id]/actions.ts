'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import { loadEventRecord } from '@/lib/event-record-data'
import {
  canChangeEventRecord,
  LICENCE_WORD,
  type Gate,
  type LicenceState,
} from '@/lib/event-record'
import { bookingStep, nextBooking, type BookingStatus } from '@/lib/parts'
import { said, type Said } from '@/lib/toast'
import { dateLabel, money } from '@/lib/format'
import { challengeHold, confirmHold, placeHold, releaseHold } from '@/lib/holds-data'
import { cleanDoor } from '@/lib/actuals'
import type {
  BookingStatus as BookingStatusRow,
  DealState,
  Licence,
  LeadRole,
} from '@/generated/prisma/client'

/**
 * The event record's own mutations.
 *
 * Nothing is exported from here without a control that reaches it. An
 * exported server action is a live POST endpoint whether or not a button
 * points at it, so an unused one is attack surface with no user. Confirming
 * the tech plan belongs to the Tech module and lands with it.
 *
 * Each re-checks the module and the event scope for itself. An action is a
 * POST endpoint reachable by anyone who knows it exists — the page that drew
 * the button is not a security boundary. Same reasoning as design/actions.ts.
 *
 * Neither check is enough on its own. An external promoter carries Pipeline
 * and is in scope for their own organisation's events, so both let them
 * through, and neither asks whether they may *change* what they can read.
 * `canChangeEventRecord` does, between the two: after the module check, so a
 * role without Pipeline still gets the 404 and learns nothing; before the
 * event lookup, because the answer does not depend on which event it is. It
 * is refused with a toast rather than a 404 — the record is theirs to read,
 * so there is no existence left to hide, only an explanation owed — the same
 * way Admin refuses an external account. actions.test.ts calls every export
 * here as a promoter, so an action added without the check fails there.
 *
 * What is *not* here matters as much as what is. Ticket prices, shifts, hours
 * and asset states are edited in their own modules, which already own those
 * mutations and already write their own activity lines. Duplicating them here
 * would give the same field two writers.
 */

const LICENCE_DB: Record<LicenceState, Licence> = {
  not_required: 'NOT_REQUIRED',
  required: 'REQUIRED',
  applied_for: 'APPLIED_FOR',
  confirmed: 'CONFIRMED',
  denied: 'DENIED',
}

const BOOKING_ROW: Record<BookingStatus, BookingStatusRow> = {
  enquiry: 'ENQUIRY',
  negotiating: 'NEGOTIATING',
  confirmed: 'CONFIRMED',
}

/** The refusal for a move whose gates are not clear. Names the first blocker. */
function heldUp(gates: Gate[]): string {
  const blocked = gates.filter((g) => !g.ok)
  return blocked.length === 1
    ? `Still held up: ${blocked[0]!.label.toLowerCase()}.`
    : `Still held up by ${blocked.length} things, starting with ${blocked[0]!.label.toLowerCase()}.`
}

/**
 * Move the booking one step on: enquiry to negotiating, negotiating to
 * confirmed.
 *
 * The booking is the one part of an event a person moves by hand — every
 * other part's status is worked out from its own records — so this and
 * `putToBed` are where the gates still refuse. They are re-evaluated here
 * rather than trusted from the page: the button being enabled is a
 * convenience, and a booking whose gates have failed since the page rendered
 * does not move.
 *
 * `from` is the status the page showed. Without it, a page opened at Enquiry
 * would confirm a booking somebody had moved to Negotiating in the meantime —
 * one press, two steps, and tickets one click away on the strength of a
 * button that said something else. The write is conditional on it too, so
 * two presses in the same moment move the booking once.
 */
export async function advanceBooking(eventId: string, from: BookingStatus): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const rec = await loadEventRecord(user, id)
  if (!rec) return said('That event is not one you can move.', 'stop')

  if (rec.booking !== from) {
    return said(
      `Nothing moved — the booking has moved on since this page was opened. It is at ${bookingStep(rec.booking).label} now.`,
      'warn',
    )
  }

  const to = nextBooking(rec.booking)
  if (!to || rec.next?.kind !== 'booking') {
    return said('The booking is already confirmed — there is nowhere further for it to go.', 'warn')
  }
  if (!rec.next.clear) return said(heldUp(rec.next.gates), 'stop')

  const moved = await db.event.updateMany({
    where: { id, bookingStatus: BOOKING_ROW[from] },
    // bookingStatusSince restarts, so days-at-status counts from now. It is
    // never stored as a duration, so it cannot go stale.
    data: { bookingStatus: BOOKING_ROW[to], bookingStatusSince: new Date() },
  })
  if (moved.count === 0) {
    return said('Nothing moved — somebody moved this booking in the same moment.', 'warn')
  }

  const label = bookingStep(to).label
  await record(
    id,
    user,
    to === 'confirmed' ? 'confirmed the booking' : `moved the booking to ${label}`,
  )

  refresh()
  return said(
    to === 'confirmed'
      ? 'Booking confirmed — tickets can go on sale now.'
      : `Now at ${label} — the terms are what hold it up next.`,
  )
}

/**
 * Put a counted night to bed.
 *
 * Only a confirmed booking whose night has happened gets here, and only once
 * the hours are logged and both halves of the night are counted. Refused in
 * words otherwise, for the same reason as `advanceBooking`: the page that drew
 * the button is not the control.
 */
export async function putToBed(eventId: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const rec = await loadEventRecord(user, id)
  if (!rec) return said('That event is not one you can move.', 'stop')

  if (rec.concluded) return said('This event is already put to bed.', 'warn')
  if (rec.booking !== 'confirmed') {
    return said('This booking was never confirmed, so there is no night to put to bed.', 'warn')
  }
  if (rec.next?.kind !== 'settle') {
    return said('Not yet — a night is put to bed once it has happened and been counted.', 'warn')
  }
  if (!rec.next.clear) return said(heldUp(rec.next.gates), 'stop')

  await db.event.update({ where: { id }, data: { concluded: true } })
  await record(id, user, 'put this event to bed')

  refresh()
  return said('Concluded — it moves off the pipeline and into Finance for settlement.')
}

/** Assign or clear a department lead. */
export async function setLead(
  eventId: string,
  role: LeadRole,
  personId: string | null,
): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  if (personId === null) {
    await db.eventLead.deleteMany({ where: { eventId: id, role } })
    await record(id, user, `left ${role.toLowerCase()} without a lead`)
    refresh()
    return said(`Nobody owns ${role.toLowerCase()} now — the stage gate will hold on it.`, 'warn')
  }

  const person = await db.person.findFirst({
    where: { id: personId, active: true },
    select: { id: true, name: true },
  })
  if (!person) return said('That person is not on the books.', 'stop')

  await db.eventLead.upsert({
    where: { eventId_role: { eventId: id, role } },
    create: { eventId: id, role, personId: person.id },
    update: { personId: person.id },
  })
  await record(id, user, `put ${person.name} on ${role.toLowerCase()}`)

  refresh()
  return said(`${person.name} owns ${role.toLowerCase()} on this one.`)
}

/**
 * Set where the special licence stands.
 *
 * Denied is not refused here — the council's answer is a fact, and the event
 * record has to be able to hold it. What it does is block the Licence part,
 * red on the Pipeline, until the coordinator changes the bar close or the date.
 */
export async function setLicence(eventId: string, state: LicenceState): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const value = LICENCE_DB[state]
  if (!value) return said('That is not a licence state.', 'stop')

  await db.event.update({ where: { id }, data: { licence: value } })
  await record(id, user, `set the special licence to ${LICENCE_WORD[state]}`)

  refresh()
  return said(
    state === 'denied'
      ? 'Recorded as denied — the licence stays blocked until the bar close or the date changes.'
      : `Licence is ${LICENCE_WORD[state]}.`,
    state === 'denied' ? 'stop' : 'good',
  )
}

/** Set a run time. Stored as the venue says it — "8:00pm", "1:00am". */
export async function setRunTime(
  eventId: string,
  field: 'doors' | 'barClose' | 'allOut',
  value: string,
): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  await db.event.update({ where: { id }, data: { [field]: value || null } })

  const label = field === 'barClose' ? 'bar close' : field === 'allOut' ? 'everyone out' : 'doors'
  await record(id, user, `set ${label} to ${value}`)

  refresh()
  return said(
    field === 'barClose'
      ? 'Bar close set — the licence gate and every shift read off it.'
      : `${label[0]!.toUpperCase()}${label.slice(1)} set.`,
  )
}

/**
 * Record where the terms stand with the promoter.
 *
 * A query carries their words. Recording one without them is refused: the
 * gate shows the note verbatim to the coordinator, and "they queried it:"
 * followed by nothing tells them to go and find an email.
 */
export async function setDeal(eventId: string, state: DealState, note: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const trimmed = note.trim()
  if (state === 'QUERIED' && !trimmed) {
    return said('Say what they queried — the coordinator sees their words, not a status.', 'warn')
  }

  await db.event.update({
    where: { id },
    data: { deal: state, dealNote: state === 'QUERIED' ? trimmed : null },
  })

  await record(
    id,
    user,
    state === 'AGREED'
      ? 'recorded that the promoter agreed the terms'
      : state === 'QUERIED'
        ? `recorded a query from the promoter: ${trimmed}`
        : 'put the terms back to the promoter',
  )

  refresh()
  return said(
    state === 'AGREED'
      ? 'Terms agreed — that gate is clear.'
      : state === 'QUERIED'
        ? 'Query recorded. It sits on the gate until the terms are settled.'
        : 'Terms sent. The gate waits on their answer.',
    state === 'QUERIED' ? 'warn' : 'good',
  )
}

/** Lock the date, or put it back to TBC. */
export async function setDateTbc(eventId: string, tbc: boolean): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  await db.event.update({ where: { id }, data: { dateTbc: tbc } })
  await record(id, user, tbc ? 'put the date back to TBC' : 'locked the date')

  refresh()
  return said(
    tbc ? 'Back to TBC — an enquiry cannot move on until a date is held.' : 'Date locked.',
    tbc ? 'warn' : 'good',
  )
}

/**
 * Count the door: how many came through it, and what the tickets took.
 *
 * The door half of the night. The bar half is closed in Bar, off the till,
 * under the Bar permission — see src/app/(app)/bar/actions.ts. They are
 * reconciled by different people off different sources, the door off
 * Gather.rsvp and the bar off Epos Now, so neither waits for the other and
 * neither can overwrite it: this never writes a bar figure, and Bar never
 * writes a door one.
 *
 * Takings arrive GST **inclusive**, because that is what Gather.rsvp and the
 * door sheet report; `countedVals` divides by CFG.gst exactly as the
 * projection does. Refused rather than clamped when a figure is negative or
 * not a number — see `cleanDoor` — because every one of these reaches the
 * settlement and then a person.
 */
export async function countDoor(
  eventId: string,
  figures: { tickets: number; ticketRev: number },
): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const clean = cleanDoor(figures)
  if (!clean.ok) return said(clean.why, 'warn')

  const stamp = { doorSource: 'MANUAL' as const, doorReconciledBy: user.initials }
  const saved = await db.actual.upsert({
    where: { eventId: id },
    create: { eventId: id, ...clean.value, ...stamp, doorReconciledAt: new Date() },
    update: { ...clean.value, ...stamp, doorReconciledAt: new Date() },
    select: { barTake: true, barProfit: true },
  })

  await record(
    id,
    user,
    `counted the door — ${clean.value.tickets} in, ${money(clean.value.ticketRev)} in ticket takings`,
  )

  refresh()
  const barClosed = saved.barTake != null && saved.barProfit != null
  return said(
    barClosed
      ? 'Door counted. With the bar already closed, the settlement now reads off counted figures, not the model.'
      : 'Door counted — the ticket line reads off it now. The bar margin stays the model until the bar is closed.',
  )
}

/**
 * The hold ladder.
 *
 * Placing, challenging, confirming and releasing all re-check the rule inside
 * a transaction in holds-data.ts. These wrappers exist to gate the module and
 * the event scope, and to write the activity line — the decisions are not
 * taken here.
 *
 * Scoping the event does not scope the hold: the hold id comes from the
 * browser too, and could name any hold on any night. So the writers are handed
 * the scoped event with it, and refuse a hold that is not that event's — which
 * is also what keeps each activity line on the event the hold belongs to.
 */
export async function holdTheRoom(eventId: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  // A hold defaults to the event's own room and date. Holding some other
  // night is a different act and would need somewhere to say which.
  const ev = await db.event.findUniqueOrThrow({
    where: { id },
    select: { spaceId: true, date: true, space: { select: { name: true } } },
  })

  const out = await placeHold(id, ev.spaceId, ev.date)
  if (!out.ok) return said(out.why, 'warn')

  await record(id, user, `placed a hold on ${ev.space.name} for ${dateLabel(ev.date)}`)
  refresh()
  return said('Held. Nobody else can confirm that night while this stands.')
}

export async function takeTheNight(eventId: string, holdId: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const out = await confirmHold(holdId, id)
  if (!out.ok) return said(out.why, 'warn')

  await record(id, user, 'confirmed the room — every other hold on that night was released')
  refresh()
  return said('Confirmed. The room is yours and the other holds are released.')
}

export async function dropTheHold(eventId: string, holdId: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const out = await releaseHold(holdId, id)
  if (!out.ok) return said(out.why, 'warn')

  await record(id, user, 'released a hold — anyone behind it moved up')
  refresh()
  return said('Released. Whoever was behind it has moved up.')
}

export async function challengeTheHold(eventId: string, holdId: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const out = await challengeHold(holdId, id)
  if (!out.ok) return said(out.why, 'warn')

  await record(id, user, 'challenged the hold above this one')
  refresh()
  return said('Challenged. The first hold now has to take the night or give it up.')
}
