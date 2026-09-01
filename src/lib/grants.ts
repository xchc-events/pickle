import { createHash, randomBytes } from 'node:crypto'

/**
 * Access grants — the links that let somebody without an account fill in
 * their own details.
 *
 * A touring act is not staff and will never have a login. They get a link,
 * they fill in their bank details and upload their rider, and that is the
 * whole of their relationship with this product. So the link *is* the
 * credential, and it is treated like one:
 *
 *  - 32 bytes from the CSPRNG, which is not guessable.
 *  - Only the SHA-256 is stored. A database read hands over no working links,
 *    which matters because the token grants access to a payment form.
 *  - It expires. A booking is agreed weeks out, not months, and a link that
 *    outlives the conversation it came from is a liability.
 *
 * Pure, so all of this is testable without a database.
 */

/** How long a freshly minted link lasts. */
export const GRANT_TTL_DAYS = 14

/** A new token. Shown once, at creation, and never recoverable afterwards. */
export function mintToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * What goes in the database.
 *
 * Plain SHA-256 with no salt is right here, unlike for a password: the input
 * is 32 random bytes, so there is no dictionary to build and no rainbow table
 * that helps. A salt would only prevent looking a token up by its hash, which
 * is the operation we actually need.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Whether an inbound string is shaped like one of ours.
 *
 * Checked before the database is touched, so that the route that receives
 * these does not turn every scan and crawl into a query.
 */
export function tokenLooksValid(token: string): boolean {
  return token.length >= 43 && token.length <= 64 && /^[A-Za-z0-9_-]+$/.test(token)
}

export type GrantState = 'open' | 'expired' | 'revoked'

export interface GrantTiming {
  expires: Date
  usedAt: Date | null
  revokedAt: Date | null
}

/**
 * Where a grant stands.
 *
 * Note that a used grant is still open. The artist who mistypes a digit has
 * to be able to come back and fix it, and forcing them to ask for a new link
 * would mean either they do not bother or somebody emails the details
 * instead — which is the thing this whole mechanism exists to avoid. What
 * `usedAt` is for is noticing a first use that the artist did not make.
 */
export function grantStatus(g: GrantTiming, now: Date): GrantState {
  if (g.revokedAt) return 'revoked'
  if (g.expires.getTime() <= now.getTime()) return 'expired'
  return 'open'
}

/** The expiry for a link minted now. */
export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + GRANT_TTL_DAYS * 24 * 60 * 60 * 1000)
}
