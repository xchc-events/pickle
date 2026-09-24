'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { hashToken, tokenLooksValid } from '@/lib/grants'
import { offerUnavailableMessage, shiftOfferOutcome } from '@/lib/shift-offers'
import { confirmOfferedShift, declineOfferedShift } from '@/lib/shift-offers-data'
import { said, type Said } from '@/lib/toast'

/**
 * Confirm or decline through the emailed link — no session anywhere on this
 * path. The token itself is the permission, on the `AccessGrant` pattern:
 * shaped like one of ours before the database is touched, then looked up by
 * its hash, never the raw value. The actor for the activity line is whoever
 * the offer names, not whoever is sitting at this browser.
 *
 * ## Why the liveness rules are re-run here
 *
 * The page that renders the buttons is not a security boundary — the same
 * rule `src/app/g/[token]/actions.ts` states for access grants. These are
 * POST endpoints, reachable by anyone who knows they exist, and the page's
 * own check is a rendering decision: a tab left open past the expiry, or a
 * form re-submitted, arrives here with the buttons' check long behind it.
 * Confirming books an hour entry against the event, so it is money, and
 * `shiftOfferOutcome` — the same rule the page renders off — decides it
 * again on this side.
 *
 * `offeredTo` then carries the answer down into the transaction. Liveness
 * and the guard are not the same check: this one reads the offer's own row
 * and can say *why* it is dead; the guard is read from the shift inside
 * `confirmOfferedShift`, so a shift re-offered between these two reads is
 * still refused rather than confirmed onto whoever holds it by then.
 */
async function liveOfferFor(token: string, now = new Date()) {
  if (!tokenLooksValid(token)) return { offer: null, why: null }

  const offer = await db.shiftOffer.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      shiftId: true,
      personId: true,
      expires: true,
      respondedAt: true,
      response: true,
      person: { select: { initials: true } },
      shift: { select: { state: true, personId: true } },
    },
  })
  if (!offer) return { offer: null, why: null }

  const outcome = shiftOfferOutcome(
    {
      expires: offer.expires,
      respondedAt: offer.respondedAt,
      response: offer.response,
      shiftState: offer.shift.state,
      shiftPersonId: offer.shift.personId,
      offerPersonId: offer.personId,
    },
    now,
  )

  // A link that has gone stale gets the reason, not a flat refusal: the
  // person holding it did nothing wrong, and "you already confirmed this"
  // is a different message from "we do not recognise that link".
  return outcome.live
    ? { offer, why: null }
    : { offer: null, why: offerUnavailableMessage(outcome.reason) }
}

export async function confirmViaToken(token: string): Promise<Said> {
  const { offer, why } = await liveOfferFor(token)
  if (!offer) return said(why ?? 'That link is not one we recognise.', 'stop')

  const out = await confirmOfferedShift(
    offer.shiftId,
    { personId: offer.personId, who: offer.person.initials },
    { offeredTo: offer.personId },
  )
  refresh()
  return out
}

export async function declineViaToken(token: string): Promise<Said> {
  const { offer, why } = await liveOfferFor(token)
  if (!offer) return said(why ?? 'That link is not one we recognise.', 'stop')

  const out = await declineOfferedShift(
    offer.shiftId,
    { personId: offer.personId, who: offer.person.initials },
    { offeredTo: offer.personId },
  )
  refresh()
  return out
}
