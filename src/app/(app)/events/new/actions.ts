'use server'

import { revalidatePath } from 'next/cache'
import { record } from '@/lib/activity'
import { createEnquiry, loadIntakeOptions } from '@/lib/intake-data'
import { placeHold } from '@/lib/holds-data'
import {
  cleanEnquiry,
  firstError,
  mayStartEnquiry,
  readEnquiryForm,
  startedSaid,
  type FieldErrors,
} from '@/lib/intake'
import { venueToday } from '@/lib/night'
import { dateLabel } from '@/lib/format'
import { requireModule } from '@/lib/permissions'
import { said, type Said } from '@/lib/toast'

/**
 * Starting an enquiry — the one way an `Event` is born outside the seed.
 *
 * Follows the house pattern from events/[id]/actions.ts: `requireModule`
 * first, so a role without Pipeline gets the 404 before anything else runs;
 * then the verdict (`mayStartEnquiry`), refused in words because they can
 * already see Pipeline, so there is nothing left to hide, only an
 * explanation owed; then the work; then `record`; then a toast that says the
 * consequence, not the action. The permission whitelist itself lives in
 * intake.ts, and the re-derivation of scope lives in intake-data.ts — this
 * file only sequences them.
 *
 * No `redirect()` here: it would carry the response instead of the return
 * value, and the toast would never reach the client. `EnquiryForm` reads
 * `eventId` off the result and navigates itself once the toast has shown.
 *
 * Only `startEnquiry` is exported: an exported action is a live POST
 * endpoint whether or not a button points at it, so an unused one is attack
 * surface with no user.
 */

export interface Started {
  said: Said
  eventId: string | null
  errors: FieldErrors
}

export async function startEnquiry(form: FormData): Promise<Started> {
  const { user } = await requireModule('pipeline')

  const verdict = mayStartEnquiry(user)
  if (!verdict.ok) return { said: said(verdict.why, 'stop'), eventId: null, errors: {} }

  const { spaces } = await loadIntakeOptions(user)
  const cleaned = cleanEnquiry(readEnquiryForm(form), { user, today: venueToday(), spaces })
  if (!cleaned.ok) {
    const why = firstError(cleaned.errors) ?? 'Something on the form needs another look.'
    return { said: said(why, 'warn'), eventId: null, errors: cleaned.errors }
  }
  const clean = cleaned.value

  const created = await createEnquiry(user, clean)
  if (!created.ok) {
    return {
      said: said(created.why, 'warn'),
      eventId: null,
      errors: { [created.field]: created.why },
    }
  }

  let toast = startedSaid({
    external: user.external,
    hasOwner: clean.ownerId !== null,
    dateTbc: clean.dateTbc,
  })

  if (clean.hold) {
    const hold = await placeHold(created.eventId, clean.spaceId, clean.date)
    if (hold.ok) {
      await record(
        created.eventId,
        user,
        `placed a hold on ${created.spaceName} for ${dateLabel(clean.date)}`,
      )
    } else {
      toast = said(`Enquiry started, but the room was not held — ${hold.why}`, 'warn')
    }
  }

  revalidatePath('/pipeline')
  return { said: toast, eventId: created.eventId, errors: {} }
}
