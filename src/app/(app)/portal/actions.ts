'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { requireEvent, requireModule } from '@/lib/permissions'
import { saveDetails } from '@/lib/payments-data'
import { ownPayee } from '@/lib/portal-data'
import { reopenAsset, sendBackAsset, signOffAsset } from '@/lib/design-signoff'
import { postComment } from '@/lib/comments-data'
import * as files from '@/lib/files-data'
import { said, type Said } from '@/lib/toast'
import type { DetailsInput, FieldError } from '@/lib/payments'

/**
 * The external promoter's own actions.
 *
 * One rule shapes most of this file: **nothing takes a payee id.**
 *
 * A promoter can only ever act on the organisation their own account belongs
 * to, and that is guaranteed by never accepting an identifier from them in
 * the first place. An action that took a payeeId would have to check it, and
 * a check is a thing that can be got wrong or forgotten later; there is
 * nothing to get wrong here, because the id is derived from the session on
 * every call.
 *
 * Note also what is *absent*: there is no reveal. A promoter enters their
 * account number and never reads it back — `canReveal` in payments.ts refuses
 * every external user outright, whatever their permission rows say.
 *
 * The sign-off actions below are the one place this file *does* take an
 * event id, the same way Design's do: `requireEvent` scopes it to an event
 * this promoter's organisation actually brought (see src/lib/scope.ts), and
 * `maySignOff` inside design-signoff.ts checks it a second time against the
 * event's own `promoterId` before writing anything. Approve, Ask for a
 * change and Reopen share their core with Design's own actions.ts — see the
 * note in src/lib/design-signoff.ts for why neither file calls the other's.
 */

export async function saveOwnDetails(
  form: DetailsInput,
): Promise<{ ok: boolean; errors?: FieldError[]; general?: string }> {
  const { user } = await requireModule('portal')

  const payee = await ownPayee(user)
  if (!payee) {
    return {
      ok: false,
      general: 'This account is not attached to a promoter organisation. Ask your coordinator.',
    }
  }

  // Not scoped to one event: the details belong to the organisation, and it
  // is the same account whichever show is being settled.
  const res = await saveDetails(payee.id, form, { eventId: null, who: payee.name })

  if (res.ok) refresh()
  return res
}

// ------------------------------------------------------------- sign-off ---

/** Sign a piece off. */
export async function approvePiece(eventId: string, key: string): Promise<Said> {
  const { user } = await requireModule('portal')
  const id = await requireEvent(user, eventId)
  const out = await signOffAsset(id, key, user)
  if (out.kind !== 'stop') refresh()
  return out
}

/** Ask for a change. Their words become a comment design sees, and the piece goes back to draft. */
export async function askForChange(eventId: string, key: string, words: string): Promise<Said> {
  const { user } = await requireModule('portal')
  const id = await requireEvent(user, eventId)
  const out = await sendBackAsset(id, key, user, words)
  if (out.kind !== 'stop') refresh()
  return out
}

/** D3 — reopen a signed-off piece. Same signers as Approve; the reason becomes a comment. */
export async function reopenPiece(eventId: string, key: string, reason: string): Promise<Said> {
  const { user } = await requireModule('portal')
  const id = await requireEvent(user, eventId)
  const out = await reopenAsset(id, key, user, reason)
  if (out.kind !== 'stop') refresh()
  return out
}

/**
 * D5 — a comment, either on one piece (`key`) or on the event's general
 * design thread (`key` is null).
 */
export async function postPortalComment(
  eventId: string,
  key: string | null,
  body: string,
): Promise<Said> {
  const { user } = await requireModule('portal')
  const id = await requireEvent(user, eventId)
  const res = await postComment(id, key, user, body)
  if (!res.ok) return said(res.why, 'stop')
  refresh()
  return said('Posted.')
}

/**
 * A short-lived link to the artwork — the same presigned read Design's
 * `linkToArtwork` gives its own staff, scoped here to an event this
 * promoter's organisation actually brought.
 */
export async function linkToArtwork(eventId: string, fileId: string): Promise<string | null> {
  const { user } = await requireModule('portal')
  const id = await requireEvent(user, eventId)

  const row = await db.storedFile.findUnique({ where: { id: fileId }, select: { eventId: true } })
  if (!row || row.eventId !== id) return null

  return files.linkTo(fileId)
}
