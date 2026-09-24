'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { requireModule } from '@/lib/permissions'
import { confirmOfferedShift, declineOfferedShift } from '@/lib/shift-offers-data'
import { said, type Said } from '@/lib/toast'

/**
 * The offered person answering from their own Home — "other times they're
 * assigning people and hoping they take those ones, and they should be able
 * to come in and confirm them" (Connor).
 *
 * Gated on nothing but being the person the shift is offered to: the query
 * itself scopes to `personId` and `state: 'OFFERED'`, so a shift offered to
 * somebody else, already answered, or not offered at all is simply not
 * found — another person's account cannot reach it by guessing an id. The
 * actual confirm/decline transaction is shared with Roster and the emailed
 * link; see `src/lib/shift-offers-data.ts`.
 */
async function myOfferedShift(shiftId: string, personId: string | null) {
  if (!personId) return null
  return db.shift.findFirst({
    where: { id: shiftId, personId, state: 'OFFERED' },
    select: { id: true },
  })
}

export async function confirmMyOffer(shiftId: string): Promise<Said> {
  const { user } = await requireModule('home')
  const personId = user.personId
  const mine = await myOfferedShift(shiftId, personId)
  if (!mine || !personId) return said('That is not one of your offered shifts.', 'stop')

  // `offeredTo` re-states the check the lookup above just made, inside the
  // transaction's own read: a shift re-offered to somebody else in between
  // is refused rather than confirmed onto them.
  const out = await confirmOfferedShift(
    shiftId,
    { personId, who: user.initials },
    { offeredTo: personId },
  )
  refresh()
  return out
}

export async function declineMyOffer(shiftId: string): Promise<Said> {
  const { user } = await requireModule('home')
  const personId = user.personId
  const mine = await myOfferedShift(shiftId, personId)
  if (!mine || !personId) return said('That is not one of your offered shifts.', 'stop')

  const out = await declineOfferedShift(
    shiftId,
    { personId, who: user.initials },
    { offeredTo: personId },
  )
  refresh()
  return out
}
