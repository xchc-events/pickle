'use server'

import { db } from '@/lib/db'
import { resolveGrant } from '@/lib/grants-data'
import { saveDetails } from '@/lib/payments-data'
import * as files from '@/lib/files-data'
import { GRANTABLE_KINDS, type FileKindKey } from '@/lib/files'
import { said, type Said } from '@/lib/toast'
import type { DetailsInput, FieldError } from '@/lib/payments'

/**
 * What somebody outside the venue can do with a link.
 *
 * Every one of these re-resolves the token for itself. The page that rendered
 * the form is not a security boundary — these are POST endpoints, reachable
 * by anyone who knows they exist, and a caller supplying their own token is
 * exactly the case they have to survive. Same reasoning as the module checks
 * in src/app/(app)/design/actions.ts.
 *
 * Two rules beyond the token being valid:
 *
 *  - Scope is enforced, not assumed. A link issued for a rider cannot write
 *    payment details, whatever the form on the other end posts.
 *  - A grant may only finish an upload it started. Otherwise any valid link
 *    could complete somebody else's pending file.
 */

const scopeAllows = (scope: string, want: 'payment' | 'files') =>
  scope === 'BOTH' || (want === 'payment' ? scope === 'PAYMENT_DETAILS' : scope === 'RIDER')

export async function saveViaGrant(
  token: string,
  form: DetailsInput,
): Promise<{ ok: boolean; errors?: FieldError[]; general?: string }> {
  const grant = await resolveGrant(token)
  if (!grant) {
    return { ok: false, general: 'This link is no longer valid.' }
  }

  if (!scopeAllows(grant.scope, 'payment')) {
    return { ok: false, general: 'This link does not cover payment details.' }
  }

  return saveDetails(grant.payeeId, form, {
    eventId: grant.eventId,
    // The audit line names the act, because there is no staff member to name.
    who: grant.payeeName,
  })
}

export async function beginViaGrant(
  token: string,
  kind: string,
  name: string,
  mime: string,
  size: number,
): Promise<{ ok: boolean; fileId?: string; url?: string; why?: string }> {
  const grant = await resolveGrant(token)
  if (!grant) return { ok: false, why: 'This link is no longer valid.' }
  if (!scopeAllows(grant.scope, 'files')) {
    return { ok: false, why: 'This link does not cover uploads.' }
  }

  // An outside party may only write the kinds meant for them. BRAND is
  // absent from this list on purpose — it is the one kind that takes SVG.
  if (!GRANTABLE_KINDS.includes(kind as FileKindKey)) {
    return { ok: false, why: 'That is not something this form accepts.' }
  }

  const started = await files.begin({
    kind: kind as FileKindKey,
    name,
    mime,
    size,
    eventId: grant.eventId,
    payeeId: grant.payeeId,
    grantId: grant.id,
  })

  return started.ok
    ? { ok: true, fileId: started.fileId, url: started.url }
    : { ok: false, why: started.why }
}

export async function finishViaGrant(token: string, fileId: string): Promise<Said> {
  const grant = await resolveGrant(token)
  if (!grant) return said('This link is no longer valid.', 'stop')

  // The row must be one this grant started. Without this, a valid link could
  // complete a pending upload belonging to somebody else entirely.
  const row = await db.storedFile.findUnique({
    where: { id: fileId },
    select: { grantId: true, name: true },
  })
  if (!row || row.grantId !== grant.id) {
    return said('That upload is not one this link started.', 'stop')
  }

  const done = await files.finish(fileId)
  if (!done.ok) return said(done.why, 'stop')

  return said(`${row.name} is with the venue. You can replace it any time from this link.`)
}
