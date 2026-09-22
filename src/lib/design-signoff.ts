import 'server-only'
import { db } from './db'
import { record } from './activity'
import { postComment } from './comments-data'
import { ASSET_SET, allApproved, assetSpec, maySignOff, type EventAsset } from './design'
import { said, type Said } from './toast'
import type { SessionUser } from './session'

/**
 * D6/D3 — signing a piece off, asking for a change, and reopening one.
 *
 * The core behind both Design's and the promoter portal's own actions.
 * Neither surface calls the other's: each has its own `'use server'`
 * export, checking its own module (`requireModule('design')` or
 * `requireModule('portal')`) and its own event scope first, exactly as
 * every other action in this app does — see design/actions.ts and
 * portal/actions.ts. What is shared is what happens once that check has
 * passed, so the two screens cannot quietly grow different rules about who
 * may sign.
 */

const REFUSAL = "Sign-off is the owner's or the promoter's call — design puts a piece up for review."

async function eventFor(eventId: string): Promise<{ ownerId: string | null; promoterId: string | null } | null> {
  return db.event.findUnique({ where: { id: eventId }, select: { ownerId: true, promoterId: true } })
}

/** The same flattening design/actions.ts always did, now shared. */
async function assetsOf(eventId: string): Promise<EventAsset[]> {
  const rows = await db.asset.findMany({ where: { eventId } })
  return ASSET_SET.map((s) => {
    const row = rows.find((r) => r.key === s.key)
    return {
      key: s.key,
      state: (row?.state.toLowerCase() ?? 'draft') as EventAsset['state'],
      promoterSigned: row?.promoterSigned ?? false,
      signedById: row?.signedById ?? null,
    }
  })
}

/**
 * Sign a piece off — Approve, on Design or in the portal.
 *
 * Approving pulls the next piece in house order up for sign-off, so exactly
 * one thing is ever waiting on somebody; that part is unchanged from before
 * D6. What is new is who may press it, and that the signer and the moment
 * are recorded on the piece rather than only implied by an activity line.
 */
export async function signOffAsset(eventId: string, key: string, user: SessionUser): Promise<Said> {
  const event = await eventFor(eventId)
  if (!event || !maySignOff(user, event)) return said(REFUSAL, 'stop')
  const spec = assetSpec(key)
  if (!spec) return said('That is not a piece of the set.', 'stop')

  const signedAt = new Date()
  await db.asset.upsert({
    where: { eventId_key: { eventId, key } },
    create: {
      eventId,
      key,
      state: 'APPROVED',
      signedById: user.id,
      signedAt,
      promoterSigned: user.external,
    },
    update: { state: 'APPROVED', signedById: user.id, signedAt, promoterSigned: user.external },
  })

  const assets = await assetsOf(eventId)

  // The next draft in house order comes up for sign-off.
  const next = ASSET_SET.find((s) => assets.find((a) => a.key === s.key)?.state === 'draft')
  if (next) {
    await db.asset.upsert({
      where: { eventId_key: { eventId, key: next.key } },
      create: { eventId, key: next.key, state: 'REVIEW' },
      update: { state: 'REVIEW' },
    })
  }

  await record(eventId, user, `approved ${spec.name}`)

  if (!allApproved(assets)) {
    return said(`${spec.name} approved.`)
  }

  // Nothing is outstanding on the creative any more, so whatever the
  // coordinator flagged about it no longer describes the event.
  await db.event.update({ where: { id: eventId }, data: { riskNote: null } })

  return said(
    `${spec.name} approved — that was the last piece, so the design is signed off. The listings go out from Promotion.`,
  )
}

/**
 * Ask for a change — the negative side of the same sign-off decision.
 * Requires a reason: it becomes the comment design sees, and an activity
 * line records the state change itself.
 */
export async function sendBackAsset(
  eventId: string,
  key: string,
  user: SessionUser,
  words: string,
): Promise<Said> {
  const event = await eventFor(eventId)
  if (!event || !maySignOff(user, event)) return said(REFUSAL, 'stop')
  const spec = assetSpec(key)
  if (!spec) return said('That is not a piece of the set.', 'stop')
  const reason = words.trim()
  if (!reason) return said('Say what needs to change — that becomes the comment design sees.', 'stop')

  await db.asset.upsert({
    where: { eventId_key: { eventId, key } },
    create: { eventId, key, state: 'DRAFT' },
    update: { state: 'DRAFT', signedById: null, signedAt: null, promoterSigned: false },
  })
  await record(eventId, user, `sent ${spec.name} back for a change`)
  await postComment(eventId, key, user, reason)

  return said('Sent back. Design gets it in their queue, not in an email.', 'warn')
}

/**
 * D3 — reopen an approved piece. Goes back to REVIEW, clears the signature,
 * and asks why — the same way as `sendBackAsset`, a comment plus an
 * activity line — so a piece is never approved with a stale reason nobody
 * can see attached to it.
 */
export async function reopenAsset(
  eventId: string,
  key: string,
  user: SessionUser,
  reason: string,
): Promise<Said> {
  const event = await eventFor(eventId)
  if (!event || !maySignOff(user, event)) return said(REFUSAL, 'stop')
  const spec = assetSpec(key)
  if (!spec) return said('That is not a piece of the set.', 'stop')
  const words = reason.trim()
  if (!words) return said('Say why it needs to reopen — that becomes a comment.', 'stop')

  const updated = await db.asset.updateMany({
    where: { eventId, key, state: 'APPROVED' },
    data: { state: 'REVIEW', signedById: null, signedAt: null, promoterSigned: false },
  })
  if (updated.count === 0) {
    return said('That piece is not signed off, so there is nothing to reopen.', 'stop')
  }

  await record(eventId, user, `reopened ${spec.name}`)
  await postComment(eventId, key, user, words)

  return said(`${spec.name} is back in review.`, 'warn')
}
