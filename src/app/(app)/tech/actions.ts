'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
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

export async function beginTechUpload(
  eventId: string,
  kind: string,
  name: string,
  mime: string,
  size: number,
): Promise<{ ok: boolean; fileId?: string; url?: string; why?: string }> {
  const { user } = await requireModule('tech')
  const id = await requireEvent(user, eventId)

  const started = await files.begin({
    kind: kind as FileKindKey,
    name,
    mime,
    size,
    eventId: id,
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
