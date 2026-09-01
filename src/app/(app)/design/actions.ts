'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import { ASSET_SET, allApproved, assetSpec, type EventAsset } from '@/lib/design'
import * as files from '@/lib/files-data'
import { PLATFORMS } from '@/lib/promo'
import { said, type Said } from '@/lib/toast'

/**
 * Design's mutations.
 *
 * Each one re-checks the module permission and the event scope for itself:
 * an action is a POST endpoint, and the page that rendered the button is not
 * a security boundary. See src/lib/permissions.ts.
 */

async function assetsOf(eventId: string): Promise<EventAsset[]> {
  const rows = await db.asset.findMany({ where: { eventId } })
  return ASSET_SET.map((s) => {
    const row = rows.find((r) => r.key === s.key)
    return {
      key: s.key,
      state: (row?.state.toLowerCase() ?? 'draft') as EventAsset['state'],
      promoterSigned: row?.promoterSigned ?? false,
    }
  })
}

/**
 * Sign a piece off.
 *
 * Approving pulls the next piece in house order up for sign-off, so exactly
 * one thing is ever waiting on somebody. Approving the last one moves the
 * event to On sale on its own — the gate is satisfied, so holding the event
 * behind a second button press would only be ceremony.
 */
export async function approveAsset(eventId: string, key: string): Promise<Said> {
  const { user } = await requireModule('design')
  const id = await requireEvent(user, eventId)
  const spec = assetSpec(key)
  if (!spec) return said('That is not a piece of the set.', 'stop')

  await db.asset.upsert({
    where: { eventId_key: { eventId: id, key } },
    create: { eventId: id, key, state: 'APPROVED' },
    update: { state: 'APPROVED' },
  })

  const assets = await assetsOf(id)

  // The next draft in house order comes up for sign-off.
  const next = ASSET_SET.find((s) => assets.find((a) => a.key === s.key)?.state === 'draft')
  if (next) {
    await db.asset.upsert({
      where: { eventId_key: { eventId: id, key: next.key } },
      create: { eventId: id, key: next.key, state: 'REVIEW' },
      update: { state: 'REVIEW' },
    })
  }

  await record(id, user, `approved ${spec.name}`)

  if (!allApproved(assets)) {
    refresh()
    return said(`${spec.name} approved.`)
  }

  const event = await db.event.findUniqueOrThrow({
    where: { id },
    select: { stage: true },
  })

  // Nothing is outstanding on the creative any more, so whatever the
  // coordinator flagged about it no longer describes the event.
  await db.event.update({ where: { id }, data: { riskNote: null } })

  if (event.stage !== 3) {
    refresh()
    return said(`${spec.name} approved. That was the last piece.`)
  }

  await db.event.update({
    where: { id },
    data: { stage: 4, stageEnteredAt: new Date() },
  })

  // The channels that sync themselves go out. The two that need a human do
  // not: the prototype marks every channel live here, which would put a name
  // and a time against nobody and quietly pass the "every channel listed or
  // ticked off" gate on the next transition.
  for (const p of PLATFORMS.filter((x) => x.kind === 'api')) {
    await db.channelPush.upsert({
      where: { eventId_channel: { eventId: id, channel: p.key } },
      create: { eventId: id, channel: p.key, live: true, note: 'created just now', at: new Date() },
      update: { live: true, stale: false, note: 'created just now', at: new Date() },
    })
  }

  await record(id, user, 'All artwork approved — moved to On sale, auto-sync listings pushed')

  refresh()
  return said(
    `${spec.name} approved — that was the last piece, so the event moved to On sale on its own.`,
  )
}

/** Send a piece back. It lands in Design's own queue, not in somebody's inbox. */
export async function requestChange(eventId: string, key: string): Promise<Said> {
  const { user } = await requireModule('design')
  const id = await requireEvent(user, eventId)
  const spec = assetSpec(key)
  if (!spec) return said('That is not a piece of the set.', 'stop')

  await db.asset.upsert({
    where: { eventId_key: { eventId: id, key } },
    create: { eventId: id, key, state: 'DRAFT' },
    update: { state: 'DRAFT' },
  })
  await record(id, user, `sent ${spec.name} back for a change`)

  refresh()
  return said('Sent back. Design gets it in their queue, not in an email.', 'warn')
}

/**
 * Name who owns the creative.
 *
 * An empty personId clears the lead, which is not a neutral act: the
 * Confirmed → Design gate holds the event there until somebody owns it.
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
