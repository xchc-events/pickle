import 'server-only'
import { db } from './db'
import type { SessionUser } from './session'

/**
 * The audit trail.
 *
 * Every mutation writes one row here and nothing ever updates or deletes one.
 * `who` is denormalised on purpose: the initials are what the feed shows, and
 * they have to keep reading correctly for a person who later leaves.
 */
export async function record(eventId: string, user: SessionUser, text: string): Promise<void> {
  return recordAs(eventId, { personId: user.personId, who: user.initials }, text)
}

/**
 * `record`, for the writes that have no `SessionUser` behind them — a shift
 * confirmed or declined through an emailed link at `src/app/s/[token]`,
 * where the actor is whoever the offer named, not whoever is signed in.
 */
export async function recordAs(
  eventId: string,
  actor: { personId: string | null; who: string },
  text: string,
): Promise<void> {
  await db.activity.create({
    data: { eventId, personId: actor.personId, who: actor.who, text },
  })
}
