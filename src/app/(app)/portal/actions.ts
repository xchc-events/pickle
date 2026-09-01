'use server'

import { refresh } from 'next/cache'
import { requireModule } from '@/lib/permissions'
import { saveDetails } from '@/lib/payments-data'
import { ownPayee } from '@/lib/portal-data'
import type { DetailsInput, FieldError } from '@/lib/payments'

/**
 * The external promoter's own actions.
 *
 * One rule shapes this file: **nothing here takes a payee id.**
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
