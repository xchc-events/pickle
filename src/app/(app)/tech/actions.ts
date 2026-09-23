'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import * as files from '@/lib/files-data'
import type { FileKindKey } from '@/lib/files'
import { said, type Said } from '@/lib/toast'
import { sendMail } from '@/lib/email'
import { eventRecipients } from '@/lib/tech-data'
import { loadVenueSpecComponents } from '@/lib/venue-spec-data'
import {
  assembleVenueSpecText,
  includedComponents,
  recipientsMissingEmail,
  venueSpecEmail,
} from '@/lib/venue-spec'
import { runSheetFor, saveRunSheetRows } from '@/lib/run-sheet-data'
import { assembleRunSheetText, runSheetEmail } from '@/lib/run-sheet'

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
    const act = await db.eventArtist.findUnique({
      where: { id: artistId },
      select: { eventId: true },
    })
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

/** `"Static Bloom"` → `"has"`; `"Static Bloom, Kōura Records"` → `"have"`. */
function hasOrHave(count: number): string {
  return count === 1 ? 'has' : 'have'
}

/**
 * Send the venue spec: exactly the ticked components, to exactly the ticked
 * recipients.
 *
 * Connor, 23 Sep 2026: "It'd be better to have a more full-featured option
 * where you can select which components of a venue spec sheet you're
 * sending out, as not all of them are relevant to all people. It doesn't
 * make sense that it says 'venue spec sent' and then 'add it yourself',
 * because this will only be uploading on our end, whereas we want it to be
 * emailed out." `componentKeys` and `payeeIds` are re-checked against this
 * event's own candidates rather than trusted, the same reasoning as every
 * other action here — a tick-list built by the page is not the security
 * boundary.
 */
export async function sendVenueSpec(
  eventId: string,
  componentKeys: string[],
  payeeIds: string[],
): Promise<Said> {
  const { user } = await requireModule('tech')
  const id = await requireEvent(user, eventId)

  const [event, components, recipients] = await Promise.all([
    db.event.findUniqueOrThrow({ where: { id }, select: { name: true } }),
    loadVenueSpecComponents(),
    eventRecipients(id),
  ])

  const text = assembleVenueSpecText(components, componentKeys)
  if (!text.trim()) return said('Pick at least one component to send.', 'stop')
  if (payeeIds.length === 0) return said('Pick at least one recipient.', 'stop')

  const validIds = new Set(recipients.map((r) => r.payeeId))
  if (payeeIds.some((pid) => !validIds.has(pid))) {
    return said('One of those recipients is not on this event.', 'stop')
  }

  const missing = recipientsMissingEmail(recipients, payeeIds)
  if (missing.length > 0) {
    const names = missing.map((r) => r.name).join(', ')
    return said(`${names} ${hasOrHave(missing.length)} no email on file.`, 'stop')
  }

  const going = recipients.filter((r) => payeeIds.includes(r.payeeId))
  const mail = venueSpecEmail(event.name, text)
  await Promise.all(going.map((r) => sendMail(r.email!, mail)))

  const componentKeysSent = includedComponents(components, componentKeys).map((c) => c.key)
  await db.venueSpecSend.create({
    data: { eventId: id, componentKeys: componentKeysSent, payeeIds, text, sentById: user.personId },
  })

  const names = going.map((r) => r.name).join(', ')
  await record(id, user, `sent the venue spec to ${names}`)

  refresh()
  return said(`Venue spec sent to ${names}.`)
}

/**
 * Save the run sheet: replace it with exactly these rows, in this order.
 *
 * Connor, 23 Sep 2026: "A section here which allows you to fill in a run
 * sheet, like a tech run sheet, would be really helpful." One save for the
 * whole sheet — add, remove, reorder and every in-place edit land together
 * — rather than one action per row, so a reorder cannot land half-applied.
 * A row nobody put a name to is dropped rather than saved, so an empty row
 * left on the page and never filled in does not litter the sheet.
 */
export async function saveRunSheet(
  eventId: string,
  rows: { time: string | null; item: string; who: string | null; note: string | null }[],
): Promise<Said> {
  const { user } = await requireModule('tech')
  const id = await requireEvent(user, eventId)

  const cleaned = rows
    .map((r) => ({ ...r, item: r.item.trim() }))
    .filter((r) => r.item.length > 0)

  await saveRunSheetRows(id, cleaned)
  await record(id, user, 'updated the run sheet')

  refresh()
  return said('Run sheet saved.')
}

/**
 * Send the run sheet to the promoter, and to any act ticked alongside them.
 *
 * Connor, 23 Sep 2026: "And then sending that to the promoter." The
 * promoter is not a tick on this one — sending it *to* them is the point of
 * the button — so they are always included, the same way
 * `beginPromoterUpload` always files against the promoter's payee rather
 * than asking which payee it should be.
 */
export async function sendRunSheet(eventId: string, actPayeeIds: string[]): Promise<Said> {
  const { user } = await requireModule('tech')
  const id = await requireEvent(user, eventId)

  const [event, recipients] = await Promise.all([
    db.event.findUniqueOrThrow({
      where: { id },
      select: { name: true, packIn: true, doors: true, barClose: true, allOut: true, packOut: true },
    }),
    eventRecipients(id),
  ])

  const promoter = recipients.find((r) => r.kind === 'promoter')
  if (!promoter) return said('This event has no promoter payee to send to.', 'stop')

  const validIds = new Set(recipients.map((r) => r.payeeId))
  if (actPayeeIds.some((pid) => !validIds.has(pid))) {
    return said('One of those recipients is not on this event.', 'stop')
  }

  const payeeIds = [promoter.payeeId, ...actPayeeIds.filter((pid) => pid !== promoter.payeeId)]
  const missing = recipientsMissingEmail(recipients, payeeIds)
  if (missing.length > 0) {
    const names = missing.map((r) => r.name).join(', ')
    return said(`${names} ${hasOrHave(missing.length)} no email on file.`, 'stop')
  }

  const rows = await runSheetFor(id, {
    packIn: event.packIn,
    doors: event.doors,
    barClose: event.barClose,
    allOut: event.allOut,
    packOut: event.packOut,
  })
  const text = assembleRunSheetText(rows)

  const going = recipients.filter((r) => payeeIds.includes(r.payeeId))
  const mail = runSheetEmail(event.name, text)
  await Promise.all(going.map((r) => sendMail(r.email!, mail)))

  await db.runSheetSend.create({ data: { eventId: id, payeeIds, text, sentById: user.personId } })

  const names = going.map((r) => r.name).join(', ')
  await record(id, user, `sent the run sheet to ${names}`)

  refresh()
  return said(`Run sheet sent to ${names}.`)
}
