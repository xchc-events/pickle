'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import * as files from '@/lib/files-data'
import { issueGrant } from '@/lib/grants-data'
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

/**
 * Create the act as a payee, so their details survive this booking.
 *
 * An act that plays four times should enter their account number once. This
 * is the moment a typed-in name becomes a record — before it, `EventArtist`
 * carries only a string, which is fine for a pipeline row and useless for
 * paying somebody.
 */
export async function linkArtistToPayee(eventId: string, artistId: string): Promise<Said> {
  const { user } = await requireModule('tech')
  const id = await requireEvent(user, eventId)

  const artist = await db.eventArtist.findFirst({
    where: { id: artistId, eventId: id },
    select: { id: true, name: true, payeeId: true },
  })
  if (!artist) return said('That act is not on this event.', 'stop')
  if (artist.payeeId) return said(`${artist.name} already has a record.`, 'warn')

  // An act of the same name is almost certainly the same act. Reusing the
  // record is the whole point — a second one would mean a second set of bank
  // details to keep straight.
  const existing = await db.payee.findFirst({
    where: { kind: 'ARTIST', name: artist.name },
    select: { id: true },
  })

  const payee =
    existing ??
    (await db.payee.create({ data: { kind: 'ARTIST', name: artist.name, country: 'NZ' } }))

  await db.eventArtist.update({ where: { id: artist.id }, data: { payeeId: payee.id } })
  await record(id, user, `linked ${artist.name} to a payee record`)

  refresh()
  return said(
    existing
      ? `${artist.name} already had a record — this booking now points at it, so their details carry across.`
      : `${artist.name} now has a record of their own. Their details will follow them to the next booking.`,
  )
}

export interface IssuedLink {
  ok: boolean
  url?: string
  expires?: string
  why?: string
}

/**
 * Mint a link for an act to fill in their own details.
 *
 * The URL comes back once and is never stored in readable form. The caller
 * shows it to the coordinator, who sends it — this deliberately does not send
 * anything itself, because a link that emails on its own is a link nobody
 * checked the address on.
 */
export async function issueArtistLink(eventId: string, artistId: string): Promise<IssuedLink> {
  const { user } = await requireModule('tech')
  const id = await requireEvent(user, eventId)

  const artist = await db.eventArtist.findFirst({
    where: { id: artistId, eventId: id },
    select: { name: true, payeeId: true },
  })
  if (!artist) return { ok: false, why: 'That act is not on this event.' }
  if (!artist.payeeId) {
    return { ok: false, why: 'Give the act a payee record first — the link points at one.' }
  }

  const grant = await issueGrant(artist.payeeId, 'BOTH', id, user.personId)
  await record(id, user, `sent ${artist.name} a link for their details and rider`)

  refresh()
  return { ok: true, url: grant.url, expires: grant.expires.toDateString() }
}
