'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { hashToken, tokenLooksValid } from '@/lib/grants'
import { confirmOfferedShift, declineOfferedShift } from '@/lib/shift-offers-data'
import { said, type Said } from '@/lib/toast'

/**
 * Confirm or decline through the emailed link — no session anywhere on this
 * path. The token itself is the permission, on the `AccessGrant` pattern:
 * shaped like one of ours before the database is touched, then looked up by
 * its hash, never the raw value. The actor for the activity line is whoever
 * the offer names, not whoever is sitting at this browser.
 */
async function offerFor(token: string) {
  if (!tokenLooksValid(token)) return null
  return db.shiftOffer.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { shiftId: true, personId: true, person: { select: { initials: true } } },
  })
}

export async function confirmViaToken(token: string): Promise<Said> {
  const offer = await offerFor(token)
  if (!offer) return said('That link is not one we recognise.', 'stop')

  const out = await confirmOfferedShift(offer.shiftId, {
    personId: offer.personId,
    who: offer.person.initials,
  })
  refresh()
  return out
}

export async function declineViaToken(token: string): Promise<Said> {
  const offer = await offerFor(token)
  if (!offer) return said('That link is not one we recognise.', 'stop')

  const out = await declineOfferedShift(offer.shiftId, {
    personId: offer.personId,
    who: offer.person.initials,
  })
  refresh()
  return out
}
