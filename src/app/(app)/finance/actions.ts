'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { requireEvent, requireModule } from '@/lib/permissions'
import { forgetDetails, revealFor, type RevealedDetails } from '@/lib/payments-data'
import { issueGrant, revokeGrant } from '@/lib/grants-data'
import { grantStatus } from '@/lib/grants'
import { said, type Said } from '@/lib/toast'

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
