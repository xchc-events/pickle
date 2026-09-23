'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import * as files from '@/lib/files-data'
import type { FileKindKey } from '@/lib/files'
import { said, type Said } from '@/lib/toast'

/**
 * Tech production's mutations.
 *
 * Each re-checks the module and the event scope for itself. A server action
 * is a POST endpoint and the page that rendered the button is not a security
 * boundary — same reasoning as src/app/(app)/design/actions.ts.
 */

/**
 * Start a rider or stage plot for one act's slot, or the venue spec
 * (`artistId` null) — never the promoter's own row; see `beginPromoterUpload`.
 *
 * `artistId` is re-checked against this event rather than trusted, the same
 * as `eventId` itself: a caller supplying somebody else's act is exactly the
 * case a POST endpoint has to survive.
 */
export async function beginTechUpload(
  eventId: string,
  kind: string,
  artistId: string | null,
  name: string,
  mime: string,
  size: number,
): Promise<{ ok: boolean; fileId?: string; url?: string; why?: string }> {
  const { user } = await requireModule('tech')
  const id = await requireEvent(user, eventId)

  if (artistId) {
    const act = await db.eventArtist.findUnique({ where: { id: artistId }, select: { eventId: true } })
    if (!act || act.eventId !== id) return { ok: false, why: 'That act is not on this event.' }
  }

  const started = await files.begin({
    kind: kind as FileKindKey,
    name,
    mime,
    size,
    eventId: id,
    artistId,
    uploadedById: user.personId,
  })

  return started.ok
    ? { ok: true, fileId: started.fileId, url: started.url }
    : { ok: false, why: started.why }
}

/**
 * Start a file for the promoter's own row. Filed against their payee record
 * (`payeeId`), not a slot — the promoter is not an act.
 */
export async function beginPromoterUpload(
  eventId: string,
  kind: string,
  name: string,
  mime: string,
  size: number,
): Promise<{ ok: boolean; fileId?: string; url?: string; why?: string }> {
  const { user } = await requireModule('tech')
  const id = await requireEvent(user, eventId)

  const event = await db.event.findUniqueOrThrow({ where: { id }, select: { promoterId: true } })
  if (!event.promoterId) {
    return { ok: false, why: 'This event has no promoter payee to file it against.' }
  }

  const started = await files.begin({
    kind: kind as FileKindKey,
    name,
    mime,
    size,
    eventId: id,
    payeeId: event.promoterId,
    uploadedById: user.personId,
  })

  return started.ok
    ? { ok: true, fileId: started.fileId, url: started.url }
    : { ok: false, why: started.why }
}

export async function finishTechUpload(eventId: string, fileId: string): Promise<Said> {
  const { user } = await requireModule('tech')
  const id = await requireEvent(user, eventId)

  // The row must belong to the event the caller claims to be working on.
  const row = await db.storedFile.findUnique({
    where: { id: fileId },
    select: { eventId: true, name: true },
  })
  if (!row || row.eventId !== id) return said('That upload is not on this event.', 'stop')

  const done = await files.finish(fileId, user)
  if (!done.ok) return said(done.why, 'stop')

  refresh()
  return said(`${row.name} is on the event. The crew sees it wherever the event is open.`)
}

/** A short-lived link to read one file. Never a permanent URL. */
export async function linkToFile(eventId: string, fileId: string): Promise<string | null> {
  const { user } = await requireModule('tech')
  const id = await requireEvent(user, eventId)

  const row = await db.storedFile.findUnique({
    where: { id: fileId },
    select: { eventId: true },
  })
  if (!row || row.eventId !== id) return null

  return files.linkTo(fileId)
}

/**
 * Pick which act an unassigned file belongs to.
 *
 * Both the file and the act are re-checked against this event: a picker only
 * ever offers acts and files that are already on the page, but the action
 * cannot assume the request it receives came from that picker.
 */
export async function assignFileToArtist(
  eventId: string,
  fileId: string,
  artistId: string,
): Promise<Said> {
  const { user } = await requireModule('tech')
  const id = await requireEvent(user, eventId)

  const [file, act] = await Promise.all([
    db.storedFile.findUnique({ where: { id: fileId }, select: { eventId: true, name: true } }),
    db.eventArtist.findUnique({ where: { id: artistId }, select: { eventId: true, name: true } }),
  ])
  if (!file || file.eventId !== id) return said('That file is not on this event.', 'stop')
  if (!act || act.eventId !== id) return said('That act is not on this event.', 'stop')

  const done = await files.attachToArtist(fileId, artistId)
  if (!done.ok) return said(done.why, 'stop')

  await record(id, user, `attached ${file.name} to ${act.name}`)

  refresh()
  return said(`${file.name} is now on ${act.name}’s row.`)
}
