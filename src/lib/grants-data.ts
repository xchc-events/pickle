import 'server-only'
import { db } from './db'
import { linkBase } from './auth-rules'
import { expiryFrom, grantStatus, hashToken, mintToken, tokenLooksValid } from './grants'
import type { GrantScope } from '@/generated/prisma/client'

/**
 * Resolving and issuing access grants.
 *
 * The rules are in `grants.ts` and tested there. This is the part that talks
 * to the database, and it exists mostly to make one thing impossible: there
 * is no function here that returns a grant without checking its state first.
 * A caller cannot accidentally accept an expired link, because it never gets
 * one to accept.
 */

export interface OpenGrant {
  id: string
  scope: GrantScope
  payeeId: string
  payeeName: string
  payeeCountry: string
  eventId: string | null
  eventName: string | null
  eventDate: Date | null
  /** The act this grant is for, when the payee is linked as a live act on
   *  this event — a rider uploaded through the grant lands on this act, and
   *  the page says whose it is asking for. Null off an event-less grant, or
   *  one whose payee is not (yet) linked as an act here. */
  artistId: string | null
  artistName: string | null
  expires: Date
  /** True the first time this link is followed. */
  firstUse: boolean
}

/**
 * Turn a token from a URL into a grant, or nothing.
 *
 * Returns null for every failure — bad shape, unknown token, expired, revoked
 * — and deliberately does not say which. The person holding a valid link
 * never sees these cases, and the person holding an invalid one is not owed
 * an explanation of why it did not work.
 */
export async function resolveGrant(token: string, now = new Date()): Promise<OpenGrant | null> {
  // Checked before the database is touched, so a crawler hitting /g/foo does
  // not become a query.
  if (!tokenLooksValid(token)) return null

  const row = await db.accessGrant.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      payee: { select: { id: true, name: true, country: true } },
      event: { select: { id: true, name: true, date: true } },
    },
  })
  if (!row) return null

  if (grantStatus(row, now) !== 'open') return null

  const firstUse = row.usedAt === null
  if (firstUse) {
    await db.accessGrant.update({ where: { id: row.id }, data: { usedAt: now } })
  }

  // Which act this grant is for, if any — the payee linked as a live act on
  // the event the grant was issued about. A grant with no event, or whose
  // payee has not been added as an act here, simply has no act to carry.
  const artist = row.event
    ? await db.eventArtist.findFirst({
        where: { eventId: row.event.id, payeeId: row.payee.id },
        select: { id: true, name: true },
      })
    : null

  return {
    id: row.id,
    scope: row.scope,
    payeeId: row.payee.id,
    payeeName: row.payee.name,
    payeeCountry: row.payee.country,
    eventId: row.event?.id ?? null,
    eventName: row.event?.name ?? null,
    eventDate: row.event?.date ?? null,
    artistId: artist?.id ?? null,
    artistName: artist?.name ?? null,
    expires: row.expires,
    firstUse,
  }
}

export interface IssuedGrant {
  /** The full link. Shown once — it cannot be recovered from the database. */
  url: string
  expires: Date
}

/**
 * What the coordinator is told when `issueGrant` refuses.
 *
 * One sentence for every screen that issues a link, so Tech and Finance cannot
 * drift into saying different things about the same missing setting.
 */
export const NO_LINK_ADDRESS =
  'Links cannot be issued from this install until AUTH_URL is set. No link was made — ask whoever looks after the install to set it.'

/**
 * Mint a link for somebody outside the venue.
 *
 * The token is returned here and nowhere else. What goes into the database is
 * its hash, so this is the only moment the link exists in a readable form —
 * which is why the caller's job is to put it in front of the coordinator
 * immediately rather than store it for later.
 *
 * Null when there is nowhere safe to point it — see `linkBase` — and the caller
 * says `NO_LINK_ADDRESS`. That is decided before the token is minted: a link to
 * localhost looks fine to the coordinator who copies it and is dead to the act
 * who opens it, and a grant nobody can follow is still a live credential.
 */
export async function issueGrant(
  payeeId: string,
  scope: GrantScope,
  eventId: string | null,
  createdById: string | null,
  now = new Date(),
): Promise<IssuedGrant | null> {
  const base = linkBase(process.env.AUTH_URL, process.env.NODE_ENV)
  if (!base) {
    console.error(
      `Cannot issue a link (${scope}) for payee ${payeeId}: AUTH_URL is not set, so there is no safe address to point it at.`,
    )
    return null
  }

  const token = mintToken()
  const expires = expiryFrom(now)

  await db.accessGrant.create({
    data: { tokenHash: hashToken(token), scope, payeeId, eventId, createdById, expires },
  })

  return { url: `${base}/g/${token}`, expires }
}

/**
 * Withdraw a link.
 *
 * Revoking is preferred to deleting: the row is what says a link once existed
 * and was used, and that is worth keeping after somebody decides it should
 * not have been sent.
 */
export async function revokeGrant(grantId: string, now = new Date()): Promise<void> {
  await db.accessGrant.update({ where: { id: grantId }, data: { revokedAt: now } })
}

/** Every grant issued against a payee, for the coordinator who has to manage them. */
export async function grantsFor(payeeId: string, now = new Date()) {
  const rows = await db.accessGrant.findMany({
    where: { payeeId },
    orderBy: { createdAt: 'desc' },
    include: { event: { select: { name: true } } },
  })

  return rows.map((r) => ({
    id: r.id,
    scope: r.scope,
    state: grantStatus(r, now),
    event: r.event?.name ?? null,
    expires: r.expires,
    usedAt: r.usedAt,
    createdAt: r.createdAt,
  }))
}
