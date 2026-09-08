'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { requireEvent, requireModule } from '@/lib/permissions'
import { forgetDetails, revealFor, type RevealedDetails } from '@/lib/payments-data'
import { issueGrant, revokeGrant } from '@/lib/grants-data'
import { grantStatus } from '@/lib/grants'
import { said, type Said } from '@/lib/toast'
import { record } from '@/lib/activity'
import { flagRefusal } from '@/lib/finance-review'

/**
 * Finance's mutations.
 *
 * The one that matters is `reveal`. Everything about the way payment details
 * are stored — sealed columns, a key outside the repository, tails kept in the
 * clear so the list never needs decrypting — exists so that this single
 * function is the only way a bank account becomes readable, and so that it
 * cannot happen quietly.
 *
 * It therefore takes an event. Not because the details belong to the event —
 * they belong to the payee, across every booking — but because "why was this
 * read" must always have an answer, and the event is the answer.
 */

export type RevealResponse = { ok: true; details: RevealedDetails } | { ok: false; why: string }

export async function reveal(eventId: string, payeeId: string): Promise<RevealResponse> {
  const { user } = await requireModule('finance')
  const id = await requireEvent(user, eventId)

  // The payee must actually be on this event. Without this the event would be
  // a formality — any id would unlock any payee and the audit row would name
  // a show that had nothing to do with it.
  const onEvent = await db.payee.findFirst({
    where: {
      id: payeeId,
      OR: [{ artists: { some: { eventId: id } } }, { events: { some: { id } } }],
    },
    select: { id: true },
  })
  if (!onEvent) return { ok: false, why: 'That payee is not on this event.' }

  return revealFor(user, payeeId, id)
}

/**
 * Mark a fee as paid.
 *
 * Deliberately not automatic on reveal: looking up an account number is not
 * the same as having sent the money, and a product that conflated them would
 * quietly mark people paid who were not.
 */
export async function markPaid(eventId: string, artistId: string): Promise<Said> {
  const { user } = await requireModule('finance')
  const id = await requireEvent(user, eventId)

  const artist = await db.eventArtist.findFirst({
    where: { id: artistId, eventId: id },
    select: { id: true, name: true, paid: true },
  })
  if (!artist) return said('That act is not on this event.', 'stop')

  await db.eventArtist.update({ where: { id: artist.id }, data: { paid: !artist.paid } })
  await db.activity.create({
    data: {
      eventId: id,
      personId: user.personId,
      who: user.initials,
      text: artist.paid ? `marked ${artist.name} unpaid` : `marked ${artist.name} paid`,
    },
  })

  refresh()
  return said(
    artist.paid
      ? `${artist.name} is no longer marked paid.`
      : `${artist.name} marked paid. The settlement reads off this, not off the bank.`,
  )
}

/**
 * Withdraw a link.
 *
 * The one recovery available when a link goes to the wrong address. Revoking
 * rather than deleting: the row is what records that a link existed and was
 * followed, and that is worth more after something has gone wrong, not less.
 */
export async function revokeAllLinks(eventId: string, payeeId: string): Promise<Said> {
  const { user } = await requireModule('finance')
  const id = await requireEvent(user, eventId)

  const payee = await db.payee.findUnique({
    where: { id: payeeId },
    select: {
      name: true,
      grants: { select: { id: true, expires: true, usedAt: true, revokedAt: true } },
    },
  })
  if (!payee) return said('No such payee.', 'stop')

  const now = new Date()
  const open = payee.grants.filter((g) => grantStatus(g, now) === 'open')
  if (open.length === 0) return said('There are no live links for them.', 'warn')

  for (const g of open) await revokeGrant(g.id, now)

  await db.activity.create({
    data: {
      eventId: id,
      personId: user.personId,
      who: user.initials,
      text: `withdrew ${open.length} link${open.length === 1 ? '' : 's'} for ${payee.name}`,
    },
  })

  refresh()
  return said(
    `Withdrawn. ${open.length === 1 ? 'That link stops' : 'Those links stop'} working immediately — issue a new one if they still need to fill anything in.`,
    'warn',
  )
}

/** Issue a fresh link, for a payee whose details never arrived. */
export async function chaseDetails(
  eventId: string,
  payeeId: string,
): Promise<{
  ok: boolean
  url?: string
  why?: string
}> {
  const { user } = await requireModule('finance')
  const id = await requireEvent(user, eventId)

  const payee = await db.payee.findUnique({ where: { id: payeeId }, select: { name: true } })
  if (!payee) return { ok: false, why: 'No such payee.' }

  const grant = await issueGrant(payeeId, 'PAYMENT_DETAILS', id, user.personId)
  await db.activity.create({
    data: {
      eventId: id,
      personId: user.personId,
      who: user.initials,
      text: `issued a payment-details link for ${payee.name}`,
    },
  })

  refresh()
  return { ok: true, url: grant.url }
}

/**
 * Erase a payee's details.
 *
 * Privacy Act principle nine: personal information is not kept for longer
 * than there is a purpose for it. Once a show is settled and paid there is no
 * further reason to hold somebody's account number, and this is how it goes.
 * The payee record stays — they may play again — but sealed and empty.
 */
export async function forget(eventId: string, payeeId: string): Promise<Said> {
  const { user } = await requireModule('finance')
  const id = await requireEvent(user, eventId)

  await forgetDetails(payeeId, user, id)

  refresh()
  return said(
    'Erased. If they play again they will be asked afresh — which is the point, not a gap.',
    'warn',
  )
}

/**
 * The finance review: sign a booking off, or hold it.
 *
 * Approving and flagging are the same shape and are deliberately not one
 * function with a boolean. A flag has a precondition — it must say why — and
 * folding the two together would put that check behind an argument nobody
 * reading the call site can see.
 *
 * External promoters never reach either: `requireModule('finance')` is the
 * control, and Finance is not in their module set. The prototype also hides
 * the buttons; hiding is the courtesy, this is the refusal.
 */
export async function approveReview(eventId: string): Promise<Said> {
  const { user } = await requireModule('finance')
  const id = await requireEvent(user, eventId)

  const before = await db.financeReview.findUnique({ where: { eventId: id } })

  await db.financeReview.upsert({
    where: { eventId: id },
    create: { eventId: id, state: 'APPROVED', note: null, by: user.initials, when: new Date() },
    // Approving clears the reason. A cleared flag that kept its words would
    // leave the coordinator reading an objection that no longer stands.
    update: { state: 'APPROVED', note: null, by: user.initials, when: new Date() },
  })

  await record(
    id,
    user,
    before?.state === 'FLAGGED'
      ? 'cleared the red flag and approved this event'
      : 'approved this event',
  )

  refresh()
  return said('Approved — the milestone can go ahead.')
}

export async function flagReview(eventId: string, note: string): Promise<Said> {
  const { user } = await requireModule('finance')
  const id = await requireEvent(user, eventId)

  // Checked here, not only in the form. An empty flag is refused rather than
  // stored, because a flag without a reason tells the coordinator that
  // somebody is unhappy and nothing about what would move it.
  const refusal = flagRefusal(note)
  if (refusal) return said(refusal, 'warn')

  const reason = note.trim()

  await db.financeReview.upsert({
    where: { eventId: id },
    create: { eventId: id, state: 'FLAGGED', note: reason, by: user.initials, when: new Date() },
    update: { state: 'FLAGGED', note: reason, by: user.initials, when: new Date() },
  })

  await record(id, user, `red-flagged this event: ${reason}`)

  refresh()
  return said('Red-flagged — it sits with the coordinator until the numbers move.')
}

/**
 * Raise or reverse a money milestone.
 *
 * A flagged event cannot raise. That refusal is the entire purpose of the
 * review: the deposit is held until the numbers move. Reversing is always
 * allowed — it takes money back off the table, which a flag has no reason to
 * block.
 */
export async function toggleMilestone(eventId: string, key: 'deposit' | 'invoice'): Promise<Said> {
  const { user } = await requireModule('finance')
  const id = await requireEvent(user, eventId)

  const ev = await db.event.findUniqueOrThrow({
    where: { id },
    select: { depositRaisedAt: true, invoiceRaisedAt: true, review: { select: { state: true } } },
  })

  const field = key === 'deposit' ? 'depositRaisedAt' : 'invoiceRaisedAt'
  const raised = ev[field] !== null

  if (!raised && ev.review?.state === 'FLAGGED') {
    return said('This event is red-flagged — the invoice is held until finance clears it.', 'warn')
  }

  await db.event.update({ where: { id }, data: { [field]: raised ? null : new Date() } })

  const label = key === 'deposit' ? 'the 25% deposit invoice' : 'the settlement invoice'
  await record(id, user, raised ? `reversed ${label}` : `raised ${label}`)

  refresh()
  return said(
    raised
      ? 'Reversed — it is off the ledger again.'
      : 'Raised. It shows on the event from now on.',
  )
}
