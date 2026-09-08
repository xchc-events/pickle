'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import { loadEventRecord } from '@/lib/event-record-data'
import { canAdvance, LICENCE_WORD, type LicenceState } from '@/lib/event-record'
import { STAGES } from '@/lib/constants'
import { said, type Said } from '@/lib/toast'
import { dateLabel, money } from '@/lib/format'
import { challengeHold, confirmHold, placeHold, releaseHold } from '@/lib/holds-data'
import type { DealState, Licence, LeadRole } from '@/generated/prisma/client'

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

/**
 * Move the event to the next stage.
 *
 * The gates are re-evaluated here rather than trusted from the page. The
 * button being enabled is a convenience; this is the control, and an event
 * whose gates have failed since the page rendered does not advance.
 */
export async function advanceStage(eventId: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const id = await requireEvent(user, eventId)

  const rec = await loadEventRecord(user, id)
  if (!rec) return said('That event is not one you can move.', 'stop')

  if (!canAdvance(rec.gates)) {
    const blocked = rec.gates.filter((g) => !g.ok)
    return said(
      blocked.length === 1
        ? `Still held up: ${blocked[0]!.label.toLowerCase()}.`
        : `Still held up by ${blocked.length} things, starting with ${blocked[0]!.label.toLowerCase()}.`,
      'stop',
    )
  }

  if (rec.stage >= STAGES.length - 1) {
    await db.event.update({ where: { id }, data: { concluded: true } })
    await record(id, user, 'put this event to bed')
    refresh()
    return said('Concluded — it moves off the pipeline and into Finance for settlement.')
  }

  const next = rec.stage + 1
  await db.event.update({
    where: { id },
    // stageEnteredAt resets so days-in-stage counts from now. It is never
    // stored as a duration, so it cannot go stale.
    data: { stage: next, stageEnteredAt: new Date() },
  })
  await record(id, user, `moved this to ${STAGES[next]}`)

  refresh()
  return said(
    `Now at ${STAGES[next]} — ${STAGES[next] === 'On sale' ? 'tickets can go live' : 'the next set of gates applies'}.`,
  )
}

/** Assign or clear a department lead. */
export async function setLead(
  eventId: string,
  role: LeadRole,
  personId: string | null,
): Promise<Said> {
  const { user } = await requireModule('pipeline')
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
 * record has to be able to hold it. What it does is fail the stage gate, so
 * the coordinator has to change the bar close or the date.
 */
export async function setLicence(eventId: string, state: LicenceState): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const id = await requireEvent(user, eventId)

  const value = LICENCE_DB[state]
  if (!value) return said('That is not a licence state.', 'stop')

  await db.event.update({ where: { id }, data: { licence: value } })
  await record(id, user, `set the special licence to ${LICENCE_WORD[state]}`)

  refresh()
  return said(
    state === 'denied'
      ? 'Recorded as denied — the bar close or the date has to change before this can advance.'
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
  const id = await requireEvent(user, eventId)

  await db.event.update({ where: { id }, data: { dateTbc: tbc } })
  await record(id, user, tbc ? 'put the date back to TBC' : 'locked the date')

  refresh()
  return said(
    tbc ? 'Back to TBC — this cannot leave Enquiry until a date is held.' : 'Date locked.',
    tbc ? 'warn' : 'good',
  )
}

/**
 * Reconcile the night: what the door and the till actually took.
 *
 * This is the write the product was missing. `hasActual` gates the last
 * transition — Show week → Payout — and nothing outside `prisma/seed.ts` could
 * create the row it counts, so an event created in the product could never
 * settle. The gate was unreachable rather than merely unmet.
 *
 * Figures arrive as the venue states them: ticket and bar takings GST
 * **inclusive**, because that is what the door and the till report, and bar
 * profit GST **exclusive**, because it is already a margin. `settlement.ts`
 * divides the first two by CFG.gst exactly as the projection does, so a
 * counted night and a projected one stay comparable. Getting these terms
 * wrong is silent, so they are stated on the form as well as here.
 *
 * `source` is stored from the start. A till integration will write POS rows
 * beside these hand-entered ones, and a settlement that cannot say which is
 * which cannot be audited.
 */
export async function reconcileActuals(
  eventId: string,
  figures: { tickets: number; ticketRev: number; barTake: number; barProfit: number },
): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const id = await requireEvent(user, eventId)

  // Negative takings are a typo, not a night. Refused rather than stored,
  // because every one of these reaches the settlement and then a person.
  const clean = {
    tickets: Math.max(0, Math.trunc(figures.tickets)),
    ticketRev: Math.max(0, figures.ticketRev),
    barTake: Math.max(0, figures.barTake),
    barProfit: Math.max(0, figures.barProfit),
  }

  if (!Number.isFinite(clean.ticketRev) || !Number.isFinite(clean.barProfit)) {
    return said('Those figures do not read as numbers — nothing was saved.', 'warn')
  }

  await db.actual.upsert({
    where: { eventId: id },
    create: {
      eventId: id,
      ...clean,
      source: 'MANUAL',
      reconciledBy: user.initials,
      reconciledAt: new Date(),
    },
    update: { ...clean, source: 'MANUAL', reconciledBy: user.initials, reconciledAt: new Date() },
  })

  await record(
    id,
    user,
    `reconciled the night — ${clean.tickets} in, ${money(clean.ticketRev)} on the door, ${money(clean.barTake)} over the bar`,
  )

  refresh()
  return said('Reconciled. The settlement now reads off counted figures, not the model.')
}

/**
 * The hold ladder.
 *
 * Placing, challenging, confirming and releasing all re-check the rule inside
 * a transaction in holds-data.ts. These wrappers exist to gate the module and
 * the event scope, and to write the activity line — the decisions are not
 * taken here.
 */
export async function holdTheRoom(eventId: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
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
  const id = await requireEvent(user, eventId)

  const out = await confirmHold(holdId)
  if (!out.ok) return said(out.why, 'warn')

  await record(id, user, 'confirmed the room — every other hold on that night was released')
  refresh()
  return said('Confirmed. The room is yours and the other holds are released.')
}

export async function dropTheHold(eventId: string, holdId: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const id = await requireEvent(user, eventId)

  const out = await releaseHold(holdId)
  if (!out.ok) return said(out.why, 'warn')

  await record(id, user, 'released a hold — anyone behind it moved up')
  refresh()
  return said('Released. Whoever was behind it has moved up.')
}

export async function challengeTheHold(eventId: string, holdId: string): Promise<Said> {
  const { user } = await requireModule('pipeline')
  const id = await requireEvent(user, eventId)

  const out = await challengeHold(holdId, id)
  if (!out.ok) return said(out.why, 'warn')

  await record(id, user, 'challenged the hold above this one')
  refresh()
  return said('Challenged. The first hold now has to take the night or give it up.')
}
