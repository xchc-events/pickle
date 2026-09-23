'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import { assetSpec } from '@/lib/design'
import { reopenAsset, sendBackAsset, signOffAsset } from '@/lib/design-signoff'
import { postComment } from '@/lib/comments-data'
import * as files from '@/lib/files-data'
import { said, type Said } from '@/lib/toast'

/**
 * Design's mutations.
 *
 * Each one re-checks the module permission and the event scope for itself:
 * an action is a POST endpoint, and the page that rendered the button is not
 * a security boundary. See src/lib/permissions.ts.
 *
 * `approveAsset`, `requestChange` and `reopenPiece` are thin wrappers over
 * src/lib/design-signoff.ts, which the portal's own actions share — see the
 * note there for why sign-off itself is not decided in either actions file.
 */

/**
 * Sign a piece off. Design staff no longer reach this — see
 * `readyForSignOff` below — because D6 (23 Sep 2026) made Approve the event
 * owner's call, or the promoter's, not design's. Refused in words rather
 * than hidden, since an action is reachable however the page draws it.
 */
export async function approveAsset(eventId: string, key: string): Promise<Said> {
  const { user } = await requireModule('design')
  const id = await requireEvent(user, eventId)
  const out = await signOffAsset(id, key, user)
  if (out.kind !== 'stop') refresh()
  return out
}

/** Ask for a change. Their words become a comment design sees, and the piece goes back to draft. */
export async function requestChange(eventId: string, key: string, words: string): Promise<Said> {
  const { user } = await requireModule('design')
  const id = await requireEvent(user, eventId)
  const out = await sendBackAsset(id, key, user, words)
  if (out.kind !== 'stop') refresh()
  return out
}

/** D3 — reopen a signed-off piece. Same signers as Approve; the reason becomes a comment. */
export async function reopenPiece(eventId: string, key: string, reason: string): Promise<Said> {
  const { user } = await requireModule('design')
  const id = await requireEvent(user, eventId)
  const out = await reopenAsset(id, key, user, reason)
  if (out.kind !== 'stop') refresh()
  return out
}

/**
 * Put a piece up for review. This is design staff's half of sign-off since
 * D6: they no longer decide whether a piece is right, only that it is ready
 * for somebody who can to look at it.
 */
export async function readyForSignOff(eventId: string, key: string): Promise<Said> {
  const { user } = await requireModule('design')
  const id = await requireEvent(user, eventId)
  const spec = assetSpec(key)
  if (!spec) return said('That is not a piece of the set.', 'stop')

  const existing = await db.asset.findUnique({ where: { eventId_key: { eventId: id, key } } })
  if (existing && existing.state !== 'DRAFT') {
    return said('That piece is already up for review, or signed off.', 'stop')
  }

  await db.asset.upsert({
    where: { eventId_key: { eventId: id, key } },
    create: { eventId: id, key, state: 'REVIEW' },
    update: { state: 'REVIEW' },
  })
  await record(id, user, `put ${spec.name} up for review`)

  refresh()
  return said(`${spec.name} is up for sign-off.`)
}

/**
 * D5 — a comment, either on one piece (`key`) or on the event's general
 * design thread (`key` is null).
 */
export async function postDesignComment(
  eventId: string,
  key: string | null,
  body: string,
): Promise<Said> {
  const { user } = await requireModule('design')
  const id = await requireEvent(user, eventId)
  const res = await postComment(id, key, user, body)
  if (!res.ok) return said(res.why, 'stop')
  refresh()
  return said('Posted.')
}

/**
 * Name who owns the creative.
 *
 * An empty personId clears the lead, which is not a neutral act: the Design
 * part cannot be finished until somebody owns it.
 */
export async function setDesignLead(eventId: string, personId: string): Promise<Said> {
  const { user } = await requireModule('design')
  const id = await requireEvent(user, eventId)

  if (!personId) {
    await db.eventLead.deleteMany({ where: { eventId: id, role: 'DESIGN' } })
    await record(id, user, 'Design lead cleared')
    refresh()
    return said('Design has no lead. The stage gate will hold the event here.', 'warn')
  }

  const person = await db.person.findFirst({
    where: { id: personId, active: true },
    select: { id: true, name: true },
  })
  if (!person) return said('That is not somebody who works here.', 'stop')

  await db.eventLead.upsert({
    where: { eventId_role: { eventId: id, role: 'DESIGN' } },
    create: { eventId: id, role: 'DESIGN', personId: person.id },
    update: { personId: person.id },
  })
  await record(id, user, `${person.name} now leads design`)

  refresh()
  return said(`${person.name} leads design on this event — every chase in that stage goes to them.`)
}

// ------------------------------------------------------------- artwork ---

/**
 * The artwork itself.
 *
 * A piece of the set is a decision — approved, or sent back — and the file is
 * the thing the decision is about. Keeping them separate means a piece can be
 * signed off from a proof shown in the room, which is how the venue actually
 * works, while still having somewhere for the finished file to live.
 *
 * Uploading creates the Asset row if it does not exist yet: until now a row
 * only appeared when somebody approved or rejected a piece, and a file is
 * just as good a reason for the piece to exist.
 */
export async function beginArtworkUpload(
  eventId: string,
  key: string,
  name: string,
  mime: string,
  size: number,
): Promise<{ ok: boolean; fileId?: string; url?: string; why?: string }> {
  const { user } = await requireModule('design')
  const id = await requireEvent(user, eventId)
  if (!assetSpec(key)) return { ok: false, why: 'That is not a piece of the set.' }

  const asset = await db.asset.upsert({
    where: { eventId_key: { eventId: id, key } },
    create: { eventId: id, key },
    update: {},
    select: { id: true },
  })

  const started = await files.begin({
    kind: 'ARTWORK',
    name,
    mime,
    size,
    eventId: id,
    assetId: asset.id,
    uploadedById: user.personId,
  })

  return started.ok
    ? { ok: true, fileId: started.fileId, url: started.url }
    : { ok: false, why: started.why }
}

export async function finishArtworkUpload(eventId: string, fileId: string): Promise<Said> {
  const { user } = await requireModule('design')
  const id = await requireEvent(user, eventId)

  const row = await db.storedFile.findUnique({
    where: { id: fileId },
    select: { eventId: true, name: true, version: true },
  })
  if (!row || row.eventId !== id) return said('That upload is not on this event.', 'stop')

  const done = await files.finish(fileId, user)
  if (!done.ok) return said(done.why, 'stop')

  refresh()
  return said(
    row.version > 1
      ? `${row.name} replaces the previous version. The old one is kept — anyone who printed it can still find it.`
      : `${row.name} is on the piece. Sign-off is still a separate decision.`,
  )
}

/** A short-lived link to the artwork. Fifteen minutes, always a download. */
export async function linkToArtwork(eventId: string, fileId: string): Promise<string | null> {
  const { user } = await requireModule('design')
  const id = await requireEvent(user, eventId)

  const row = await db.storedFile.findUnique({
    where: { id: fileId },
    select: { eventId: true },
  })
  if (!row || row.eventId !== id) return null

  return files.linkTo(fileId)
}
