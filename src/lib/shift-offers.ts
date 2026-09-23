/**
 * A shift is offered before it is confirmed — R6.
 *
 * Picking somebody in Roster no longer books the hours on the spot: the
 * shift moves to `OFFERED`, and a `ShiftOffer` row is only written when the
 * offer is actually emailed (`src/app/(app)/roster/actions.ts`). Confirming
 * — by the duty manager on the spot, by the person themself on Home, or
 * through the emailed link at `src/app/s/[token]` — is what books the hour
 * entry, exactly as the old direct assignment did. Declining clears the
 * person and reopens the shift.
 *
 * This file is the part of all that worked out without a database: how long
 * an offer lasts, and whether a given link is still one somebody can act on.
 * The database side — creating the row, reading it back by token, doing the
 * confirm/decline transaction — is `src/lib/shift-offers-data.ts`.
 */

/** How long an emailed offer lasts before it stops working on its own. */
export const SHIFT_OFFER_TTL_DAYS = 7

/** The expiry for an offer minted now. */
export function shiftOfferExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + SHIFT_OFFER_TTL_DAYS * 24 * 60 * 60 * 1000)
}

/** Why a link is not one somebody can still act on. */
export type OfferUnavailableReason = 'confirmed' | 'declined' | 'expired' | 'superseded'

export type OfferOutcome = { live: true } | { live: false; reason: OfferUnavailableReason }

/**
 * Whether an offer is still live, worked out from the offer row and the
 * shift it points at together — not the offer row alone.
 *
 * A response on the row always wins, whatever else has happened since: once
 * somebody has said yes or no through this link, that is the answer, even if
 * the expiry has also passed by the time anybody reads it back.
 *
 * Short of that, an offer can go stale two ways: its own clock runs out, or
 * the shift it points at moves on without it — the duty manager confirmed
 * it in the room, re-offered the same shift to somebody else, or cleared it
 * back to open. Either reads as "superseded" rather than "expired", since
 * the link itself may still have days left on it; the shift underneath it
 * is just no longer the one thing the link promised.
 */
export function shiftOfferOutcome(
  offer: {
    expires: Date
    respondedAt: Date | null
    response: 'CONFIRMED' | 'DECLINED' | null
    shiftState: string
    shiftPersonId: string | null
    offerPersonId: string
  },
  now: Date,
): OfferOutcome {
  if (offer.respondedAt) {
    return { live: false, reason: offer.response === 'DECLINED' ? 'declined' : 'confirmed' }
  }
  if (offer.expires.getTime() <= now.getTime()) return { live: false, reason: 'expired' }
  if (offer.shiftState !== 'OFFERED' || offer.shiftPersonId !== offer.offerPersonId) {
    return { live: false, reason: 'superseded' }
  }
  return { live: true }
}

/** What the offer page says instead of the Confirm/Decline buttons. */
export function offerUnavailableMessage(reason: OfferUnavailableReason): string {
  switch (reason) {
    case 'confirmed':
      return 'You already confirmed this shift.'
    case 'declined':
      return 'You already said you can’t make this one.'
    case 'expired':
      return 'This offer has expired. Ask the coordinator for a new one.'
    case 'superseded':
      return 'This offer is no longer live — check with the coordinator.'
  }
}
