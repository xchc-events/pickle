'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import { internalContact } from '@/lib/intake'
import { loadEventRecord } from '@/lib/event-record-data'
import {
  canChangeEventRecord,
  LICENCE_WORD,
  type Gate,
  type LicenceState,
} from '@/lib/event-record'
import { nightFromInput } from '@/lib/night'
import { bookingStep, nextBooking, type BookingStatus } from '@/lib/parts'
import { said, type Said } from '@/lib/toast'
import { dateLabel, money } from '@/lib/format'
import { challengeHold, confirmHold, placeHold, releaseHold } from '@/lib/holds-data'
import { affectedLine, type AffectedHold } from '@/lib/holds'
import type { SessionUser } from '@/lib/session'
import { cleanDoor } from '@/lib/actuals'
import { clockFromInput, endNightFor, runProblems, type RunTimes } from '@/lib/run-times'
import {
  actLockedBecause,
  actNameProblem,
  attendanceProblem,
  countProblem,
  dollarsProblem,
  feeProblem,
  figuresLine,
  isBillStatus,
  isFigures,
  lockedBecause,
  MAX_CREW,
  MAX_TOKENS,
  modelLockedBecause,
  modelSaid,
  splitProblem,
  splitSaid,
  statusSaid,
  tidyName,
  type BillStatus,
  type Figures,
} from '@/lib/terms'
import { capacityOf } from '@/lib/ticketing'
import type {
  ArtistStatus,
  BookingModel,
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

/**
 * Assign or clear a department lead.
 *
 * An empty personId clears it, the same as null: LeadPicker's Unassigned
 * option sends '', and what counts as nobody is settled here rather than left
 * to whichever control calls the endpoint. A missing one clears too — Prisma
 * ignores an undefined filter, so looking it up would find any active person.
 */
export async function setLead(
  eventId: string,
  role: LeadRole,
  personId: string | null,
): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  if (!personId) {
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
 * Name the event's owner, or clear it.
 *
 * An outside promoter's enquiry arrives with nobody's name on it and sits in
 * the unclaimed queue on Home until somebody takes it. The enquiry form names
 * an owner when the venue starts a booking itself; once an event exists, this
 * is the only place its owner changes. Modelled on `setLead` just above: the
 * same refusal, the same scope, the same shape of read-then-write.
 *
 * On an internal night the booking contact string is kept in step with the
 * owner, in the same write, because it is what the "Booking contact named"
 * gate reads, not `ownerId` itself. An event an outside organisation brought
 * already carries that organisation's own contact — left alone here.
 */
export async function setOwner(eventId: string, personId: string | null): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const ev = await db.event.findUniqueOrThrow({ where: { id }, select: { internal: true } })

  if (!personId) {
    await db.event.update({
      where: { id },
      data: { ownerId: null, ...(ev.internal ? { promoter: internalContact(null) } : {}) },
    })
    await record(id, user, 'left this event without an owner')
    refresh()
    return said('Nobody owns this one now — it goes back to the unclaimed queue on Home.', 'warn')
  }

  const person = await db.person.findFirst({
    where: { id: personId, active: true },
    select: { id: true, name: true },
  })
  if (!person) return said('That person is not on the books.', 'stop')

  await db.event.update({
    where: { id },
    data: {
      ownerId: person.id,
      ...(ev.internal ? { promoter: internalContact(person.name) } : {}),
    },
  })
  await record(id, user, `made ${person.name} the owner`)

  refresh()
  return said(`${person.name} owns this one now — its gates come to them.`)
}

/**
 * The acts and terms editor.
 *
 * Nothing before this could change `EventArtist.status/low/high/name`,
 * `Event.split/model` or the figures the projection runs off — an enquiry an
 * outside promoter sends in arrives with every act "enquired" at $0, split 0
 * and no figures, and had no way to ever clear the Negotiating gates ("At
 * least one act confirmed", "Fee floor and ceiling agreed", "Split agreed").
 * These eight give the venue that one write each, and nowhere else gets it:
 * an outside promoter may open the event record and change nothing on it.
 *
 * An act id is looked up scoped to the event — `db.eventArtist.findFirst({
 * where: { id, eventId } })` — for the same reason a hold id is handed to its
 * writer scoped to the event in the hold ladder above: it came from the
 * browser and could name any act on any night, not only one on this bill. A
 * miss is refused in words, not a 404 — the event itself is theirs to read,
 * so there is no existence left to hide, only an act that is not here.
 *
 * The rules — what a fee, a split, an attendance figure or a name is allowed
 * to be, and what locks a bill or a booking model — live in @/lib/terms, the
 * one place the enquiry form and this editor agree. Nothing here repeats a
 * rule or hard-codes a message that already lives there.
 */

const ARTIST_STATUS_DB: Record<BillStatus, ArtistStatus> = {
  enquired: 'ENQUIRED',
  pencilled: 'PENCILLED',
  confirmed: 'CONFIRMED',
  declined: 'DECLINED',
}

const MODEL_DB: Record<'dry' | 'curator', BookingModel> = {
  dry: 'DRY',
  curator: 'CURATOR',
}

/**
 * Move an act to a new status on the bill.
 *
 * A paid act's line is frozen by `actLockedBecause`: their fee is already
 * part of a settlement, and moving them to declined pulls their fee back out
 * of the floor — a number that has already gone to somebody is not one this
 * can move again.
 */
export async function setActStatus(
  eventId: string,
  artistId: string,
  status: string,
): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const ev = await db.event.findUniqueOrThrow({ where: { id }, select: { concluded: true } })
  const locked = lockedBecause(ev)
  if (locked) return said(locked, 'stop')

  const act = await db.eventArtist.findFirst({ where: { id: artistId, eventId: id } })
  if (!act) return said('That act is not on this bill.', 'stop')

  const actLocked = actLockedBecause(act)
  if (actLocked) return said(actLocked, 'stop')

  if (!isBillStatus(status)) return said('That is not a status an act can have.', 'stop')

  await db.eventArtist.update({
    where: { id: artistId },
    data: { status: ARTIST_STATUS_DB[status] },
  })
  await record(id, user, `marked ${act.name} ${status}`)

  refresh()
  return statusSaid(act.name, status)
}

/**
 * Set an act's fee floor and ceiling.
 *
 * Frozen once paid, same as `setActStatus` — the fee is what the settlement
 * was built from, and changing it here would leave the settlement wrong
 * without anybody knowing there was ever a reason to redo it.
 */
export async function setActFees(
  eventId: string,
  artistId: string,
  low: number,
  high: number,
): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const ev = await db.event.findUniqueOrThrow({ where: { id }, select: { concluded: true } })
  const locked = lockedBecause(ev)
  if (locked) return said(locked, 'stop')

  const act = await db.eventArtist.findFirst({ where: { id: artistId, eventId: id } })
  if (!act) return said('That act is not on this bill.', 'stop')

  const actLocked = actLockedBecause(act)
  if (actLocked) return said(actLocked, 'stop')

  const problem = feeProblem(low, high)
  if (problem) return said(problem, 'warn')

  await db.eventArtist.update({ where: { id: artistId }, data: { low, high } })
  await record(id, user, `set ${act.name}’s fee range to ${money(low)}–${money(high)}`)

  refresh()
  return said(`${act.name} is ${money(low)}–${money(high)} — the floor and ceiling moved with it.`)
}

/**
 * Rename an act.
 *
 * Not frozen by a paid line — unlike status and fees, a name is not a money
 * figure the settlement was built from, so correcting a typo after payment
 * costs the settlement nothing.
 */
export async function renameAct(eventId: string, artistId: string, name: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const ev = await db.event.findUniqueOrThrow({ where: { id }, select: { concluded: true } })
  const locked = lockedBecause(ev)
  if (locked) return said(locked, 'stop')

  const act = await db.eventArtist.findFirst({ where: { id: artistId, eventId: id } })
  if (!act) return said('That act is not on this bill.', 'stop')

  // The id and the name both come from the browser. A name that is not text
  // at all reads as no name, and is refused as one.
  const tidied = tidyName(typeof name === 'string' ? name : '')
  if (tidied === act.name) return said('Nothing changed.', 'warn')

  const problem = actNameProblem(tidied)
  if (problem) return said(problem, 'warn')

  await db.eventArtist.update({ where: { id: artistId }, data: { name: tidied } })
  await record(id, user, `renamed ${act.name} to ${tidied}`)

  refresh()
  return said(
    `Renamed ${act.name} to ${tidied}. Listings, the contract and the door list all read this field.`,
  )
}

/**
 * Add an act to the bill.
 *
 * Ordered one past the current highest `order`, so a new act always lands at
 * the bottom of the bill rather than wherever an unset default would put it.
 * Twelve is the most one booking takes — the prototype's own ceiling — so a
 * thirteenth is refused rather than silently accepted somewhere a door list
 * or a contract would never expect to find it.
 */
export async function addAct(eventId: string, name: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const ev = await db.event.findUniqueOrThrow({ where: { id }, select: { concluded: true } })
  const locked = lockedBecause(ev)
  if (locked) return said(locked, 'stop')

  const tidied = tidyName(typeof name === 'string' ? name : '')
  const problem = actNameProblem(tidied)
  if (problem) return said(problem, 'warn')

  const existing = await db.eventArtist.findMany({
    where: { eventId: id },
    select: { order: true },
  })
  if (existing.length >= 12) return said('Twelve acts is the most one booking takes.', 'warn')

  const order = existing.length === 0 ? 0 : Math.max(...existing.map((a) => a.order)) + 1

  await db.eventArtist.create({
    data: { eventId: id, name: tidied, status: 'ENQUIRED', low: 0, high: 0, order },
  })
  await record(id, user, `added ${tidied} to the bill`)

  refresh()
  return said(
    `Added ${tidied} to the bill — set their fee range and the floor and ceiling move with it.`,
  )
}

/**
 * Take an act off the bill entirely.
 *
 * Different from marking them declined: declined keeps their row as a record
 * of what happened with the enquiry, while this removes it, for an act that
 * should never have been listed at all. Frozen once paid, same as
 * `setActStatus` — a paid line is part of the settlement and does not
 * disappear from the bill that produced it.
 */
export async function removeAct(eventId: string, artistId: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const ev = await db.event.findUniqueOrThrow({ where: { id }, select: { concluded: true } })
  const locked = lockedBecause(ev)
  if (locked) return said(locked, 'stop')

  const act = await db.eventArtist.findFirst({ where: { id: artistId, eventId: id } })
  if (!act) return said('That act is not on this bill.', 'stop')

  const actLocked = actLockedBecause(act)
  if (actLocked) return said(actLocked, 'stop')

  await db.eventArtist.delete({ where: { id: artistId } })
  await record(id, user, `took ${act.name} off the bill`)

  refresh()
  return said(`${act.name} removed from the bill.`, 'warn')
}

/** Set the split, stored as a fraction of 1 the way every read of it expects. */
export async function setSplit(eventId: string, percent: number): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const ev = await db.event.findUniqueOrThrow({ where: { id }, select: { concluded: true } })
  const locked = lockedBecause(ev)
  if (locked) return said(locked, 'stop')

  const problem = splitProblem(percent)
  if (problem) return said(problem, 'warn')

  await db.event.update({ where: { id }, data: { split: percent / 100 } })
  await record(id, user, `set the split to ${percent}% to their people`)

  refresh()
  return splitSaid(percent)
}

/**
 * Switch the booking model.
 *
 * Refused once a deposit or the settlement invoice has been raised: dry hire
 * and the curator model each read a different milestone ladder in Finance
 * (see `milestonesFor`), so switching after money has already moved against
 * one ladder would leave a milestone raised against a model the booking no
 * longer has.
 */
export async function setModel(eventId: string, model: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const ev = await db.event.findUniqueOrThrow({
    where: { id },
    select: { concluded: true, model: true, depositRaisedAt: true, invoiceRaisedAt: true },
  })
  const locked = lockedBecause(ev) ?? modelLockedBecause(ev)
  if (locked) return said(locked, 'stop')

  if (model !== 'dry' && model !== 'curator') return said('That is not a booking model.', 'stop')

  const current = ev.model === 'DRY' ? 'dry' : 'curator'
  if (model === current) return said('Nothing changed.', 'warn')

  await db.event.update({ where: { id }, data: { model: MODEL_DB[model] } })
  await record(id, user, `set the booking to ${model === 'dry' ? 'dry hire' : 'curator model'}`)

  refresh()
  return modelSaid(model)
}

/**
 * Save what the projection and the settlement run off: attendance, bar spend
 * a head, gear and hire, promotion, crew and tokens a head.
 *
 * Figures arrive as numbers, already parsed by the form — never strings —
 * and a bad one is refused rather than clamped to something nearby, the same
 * reasoning as `countDoor`: every one of these reaches the settlement and
 * then a person, so silently substituting a "close enough" value would be
 * deciding something on their behalf. Attendance is bounded by what the room
 * holds; crew and tokens a head by the same ceilings the enquiry form has
 * always had, because tokens are per head and the room says nothing about
 * them. What is not a set of figures at all is turned away before any rule
 * sees it: the endpoint takes whatever a signed-in person cares to send.
 */
export async function setFigures(eventId: string, f: Figures): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)
  if (!isFigures(f)) return said('Those are not figures.', 'stop')

  const ev = await db.event.findUniqueOrThrow({
    where: { id },
    select: {
      concluded: true,
      att: true,
      barHead: true,
      gear: true,
      adv: true,
      crew: true,
      tok: true,
      format: true,
      space: { select: { name: true, capacity: true, seatedCapacity: true } },
      barBudget: { select: { id: true } },
    },
  })
  const locked = lockedBecause(ev)
  if (locked) return said(locked, 'stop')

  const before: Figures = {
    att: ev.att as [number, number, number],
    barHead: ev.barHead,
    gear: ev.gear,
    adv: ev.adv,
    crew: ev.crew,
    tok: ev.tok,
  }

  const line = figuresLine(before, f)
  if (!line) return said('Nothing changed.', 'warn')

  const holds = capacityOf(ev.space, ev.format)
  const room = { name: ev.space.name, holds, seated: ev.format === 'Cabaret' }
  const problem =
    attendanceProblem(f.att, room) ??
    dollarsProblem(f.barHead) ??
    dollarsProblem(f.gear) ??
    dollarsProblem(f.adv) ??
    countProblem(f.crew, MAX_CREW) ??
    countProblem(f.tok, MAX_TOKENS)
  if (problem) return said(problem, 'warn')

  await db.event.update({
    where: { id },
    data: { att: f.att, barHead: f.barHead, gear: f.gear, adv: f.adv, crew: f.crew, tok: f.tok },
  })
  await record(id, user, line)

  refresh()
  return said(
    'Figures saved — the projection and the settlement read them now.' +
      (ev.barBudget ? ' The bar budget stays as it was locked.' : ''),
  )
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

/**
 * Whichever run-time rule is broken. `runProblems` can flag more than one
 * field at once (an end date past the fortnight AND a bar close chasing a
 * moved everyone-out); this is the fixed order they are surfaced in — the
 * date range first, then the night's own shape. `doors` never carries a
 * message of its own.
 */
function firstRunProblem(r: RunTimes): string | null {
  const problems = runProblems(r)
  return problems.endDate ?? problems.allOut ?? problems.barClose ?? null
}

/**
 * Set a run time. Stored as the venue says it — "8:00pm", "1:00am" — from
 * whatever an `<input type="time">` sends ("20:15"), so the licence gate, the
 * roster and the till window can keep reading the label they always have.
 *
 * The end date is nobody's to type unless they choose to (`setEndDate`
 * below). Until then it just follows doors and everyone-out: while the
 * stored value is still exactly what `endNightFor` would have inferred from
 * the OLD times (or nothing was ever stored), a change here carries it
 * forward with the new ones. The moment somebody picks a different night by
 * hand, it stops following and this leaves it alone.
 */
export async function setRunTime(
  eventId: string,
  field: 'doors' | 'barClose' | 'allOut',
  value: string,
): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  const clock = clockFromInput(value)
  if (value !== '' && clock === null) return said('That is not a time.', 'warn')

  const row = await db.event.findUniqueOrThrow({
    where: { id },
    select: { date: true, doors: true, barClose: true, allOut: true, endDate: true },
  })

  const next: RunTimes = {
    date: row.date,
    doors: field === 'doors' ? clock : row.doors,
    barClose: field === 'barClose' ? clock : row.barClose,
    allOut: field === 'allOut' ? clock : row.allOut,
    endDate: row.endDate,
  }

  let endDateChanged = false
  if (field === 'doors' || field === 'allOut') {
    const oldInferred = endNightFor(row.date, row.doors, row.allOut)
    const wasInferred =
      row.endDate === null ||
      (oldInferred !== null && row.endDate.getTime() === oldInferred.getTime())
    if (wasInferred) {
      next.endDate = endNightFor(next.date, next.doors, next.allOut)
      endDateChanged = true
    }
  }

  const problem = firstRunProblem(next)
  if (problem) return said(problem, 'warn')

  await db.event.update({
    where: { id },
    data: endDateChanged ? { [field]: clock, endDate: next.endDate } : { [field]: clock },
  })

  const label = field === 'barClose' ? 'bar close' : field === 'allOut' ? 'everyone out' : 'doors'
  const Label = `${label[0]!.toUpperCase()}${label.slice(1)}`
  await record(id, user, clock === null ? `cleared ${label}` : `set ${label} to ${clock}`)

  refresh()
  return said(
    clock === null
      ? `${Label} cleared.`
      : field === 'barClose'
        ? 'Bar close set — the licence gate and every shift read off it.'
        : `${Label} set.`,
  )
}

/**
 * Set the night an event ends, or clear it back to what doors and
 * everyone-out infer (`endNightFor`) — the same rule `setRunTime` uses to
 * carry the date forward for itself, until a choice is made here.
 */
export async function setEndDate(eventId: string, value: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const verdict = canChangeEventRecord(user)
  if (!verdict.ok) return said(verdict.why, 'stop')
  const id = await requireEvent(user, eventId)

  let night: Date | null = null
  if (value !== '') {
    night = nightFromInput(value)
    if (night === null) return said('Pick the night it ends.', 'warn')
  }

  const row = await db.event.findUniqueOrThrow({
    where: { id },
    select: { date: true, doors: true, barClose: true, allOut: true },
  })

  const resolved = night ?? endNightFor(row.date, row.doors, row.allOut)

  const problem = firstRunProblem({
    date: row.date,
    doors: row.doors,
    barClose: row.barClose,
    allOut: row.allOut,
    endDate: resolved,
  })
  if (problem) return said(problem, 'warn')

  await db.event.update({ where: { id }, data: { endDate: resolved } })

  if (resolved === null) {
    await record(id, user, 'cleared the night it ends')
    refresh()
    return said('Not decided yet — set doors and everyone out, or pick a night.', 'warn')
  }

  await record(id, user, `set the night it ends to ${dateLabel(resolved)}`)

  refresh()
  return said(`Ends ${dateLabel(resolved)} — the room is taken until then.`, 'good')
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
 *
 * Confirming, releasing and challenging also change other events' holds on the
 * night. Those events get a line too, from the writer's report of what it
 * changed — see `recordAffected`.
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
  await recordAffected(user, out.affected)
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
  await recordAffected(user, out.affected)
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
  await recordAffected(user, out.affected)
  refresh()
  return said('Challenged. The first hold now has to take the night or give it up.')
}

/**
 * A line on each other event whose hold the write changed, as the person who
 * made it.
 *
 * Their holds moved as surely as this event's did, and the activity table is
 * where every mutation is written down. The line says "another event" and never
 * which — see `affectedLine`.
 *
 * Not exported, so not an endpoint: it writes whatever report it is handed, and
 * only a writer's report of its own committed change should reach it.
 */
async function recordAffected(user: SessionUser, affected: AffectedHold[]): Promise<void> {
  for (const hold of affected) await record(hold.eventId, user, affectedLine(hold))
}
