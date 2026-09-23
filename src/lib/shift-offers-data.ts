import 'server-only'
import { db } from './db'
import { hashToken } from './grants'
import { recordAs } from './activity'
import { offerUnavailableMessage, shiftOfferOutcome } from './shift-offers'
import { said, type Said } from './toast'

/**
 * The database side of a shift offer.
 *
 * `confirmOfferedShift` and `declineOfferedShift` are the one transaction
 * every "yes" or "no" goes through, whoever says it: the duty manager
 * confirming in the room (`src/app/(app)/roster/actions.ts`), the offered
 * person on Home (`src/app/(app)/home/actions.ts`), or the emailed link
 * (`src/app/s/[token]/actions.ts`). Each of those checks its own permission
 * — module access and event scope for the duty manager, the signed-in
 * person matching the shift for Home, the token itself for the emailed link
 * — and then calls through to here with a plain `{ personId, who }` actor,
 * which is all an activity line needs and all three have in common.
 *
 * Confirming books the hour entry exactly as the old direct `assignShift`
 * did — same shape, same transaction-with-the-shift-update — because moving
 * that booking behind a confirmation is the whole of what R6 changes; the
 * booking itself is unchanged.
 */

export interface ShiftOfferView {
  role: string
  hours: number
  start: number
  eventName: string
  eventDate: Date
  personName: string
  live: boolean
  /** Why it is not live, in words for the page — set only when `live` is false. */
  message: string | null
}

/**
 * Reads an offer back by the token in the URL. Null when nothing matches —
 * a malformed link or one this install never issued — which the page turns
 * into a 404, the same as `AccessGrant`. A link that once worked but has
 * since gone stale (answered, expired, or the shift moved on some other
 * way) is not null: it resolves, `live: false`, with a message, so the page
 * can say what happened rather than pretend the link was never real.
 */
export async function resolveShiftOfferToken(
  token: string,
  now: Date = new Date(),
): Promise<ShiftOfferView | null> {
  const offer = await db.shiftOffer.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      personId: true,
      expires: true,
      respondedAt: true,
      response: true,
      shift: {
        select: {
          role: true,
          hours: true,
          start: true,
          state: true,
          personId: true,
          event: { select: { name: true, date: true } },
        },
      },
      person: { select: { name: true } },
    },
  })
  if (!offer) return null

  const outcome = shiftOfferOutcome(
    {
      expires: offer.expires,
      respondedAt: offer.respondedAt,
      response: offer.response,
      shiftState: offer.shift.state,
      shiftPersonId: offer.shift.personId,
      offerPersonId: offer.personId,
    },
    now,
  )

  return {
    role: offer.shift.role,
    hours: offer.shift.hours,
    start: offer.shift.start,
    eventName: offer.shift.event.name,
    eventDate: offer.shift.event.date,
    personName: offer.person.name,
    live: outcome.live,
    message: outcome.live ? null : offerUnavailableMessage(outcome.reason),
  }
}

/** Who did it, for the activity line — a `SessionUser`, or the offered person themself. */
export interface OfferActor {
  personId: string | null
  who: string
}

async function offeredShift(shiftId: string) {
  return db.shift.findUnique({
    where: { id: shiftId },
    include: {
      hourEntry: { select: { id: true } },
      event: { select: { date: true } },
      person: { select: { id: true, name: true } },
    },
  })
}

/**
 * They said yes. Moves the shift to ASSIGNED and books the hour entry —
 * created if this is the first time, updated (never doubled) if a hold-over
 * entry already exists. Refuses anything not currently `OFFERED`, which is
 * what makes a token good for one reply: the first confirm moves the state
 * on, so a second one — the same link clicked twice, or a stale one read
 * after the duty manager already confirmed it in the room — finds a shift
 * that is no longer OFFERED and stops there.
 */
export async function confirmOfferedShift(shiftId: string, actor: OfferActor): Promise<Said> {
  const shift = await offeredShift(shiftId)
  if (!shift || shift.state !== 'OFFERED' || !shift.personId || !shift.person) {
    return said('That offer is no longer live.', 'stop')
  }

  await db.$transaction([
    db.shift.update({ where: { id: shift.id }, data: { state: 'ASSIGNED' } }),
    shift.hourEntry
      ? db.hourEntry.update({
          where: { id: shift.hourEntry.id },
          data: {
            personId: shift.personId,
            hours: shift.hours,
            eventId: shift.eventId,
            workedOn: shift.event.date,
          },
        })
      : db.hourEntry.create({
          data: {
            personId: shift.personId,
            eventId: shift.eventId,
            shiftId: shift.id,
            hours: shift.hours,
            note: shift.role,
            workedOn: shift.event.date,
          },
        }),
    // Any offer still waiting on an answer for this shift and this person is
    // this one, whichever route just answered it — the emailed link should
    // not go on reading as live once the room has already said yes.
    db.shiftOffer.updateMany({
      where: { shiftId: shift.id, personId: shift.personId, respondedAt: null },
      data: { respondedAt: new Date(), response: 'CONFIRMED' },
    }),
  ])

  await recordAs(shift.eventId, actor, `${shift.person.name} confirmed on ${shift.role}`)

  return said(
    `${shift.person.name} is on ${shift.role}. The ${shift.hours}h are already against the event — nobody types them in again.`,
  )
}

/**
 * They said no. Clears the person and reopens the shift, with an activity
 * line naming who — the shift's own `personId` is about to be cleared, so
 * that name only survives in the audit trail if this writes it down now.
 * Books nothing: an offer that was never confirmed never had hours.
 */
export async function declineOfferedShift(shiftId: string, actor: OfferActor): Promise<Said> {
  const shift = await offeredShift(shiftId)
  if (!shift || shift.state !== 'OFFERED' || !shift.personId || !shift.person) {
    return said('That offer is no longer live.', 'stop')
  }

  await db.$transaction([
    db.shift.update({ where: { id: shift.id }, data: { personId: null, state: 'OPEN' } }),
    db.shiftOffer.updateMany({
      where: { shiftId: shift.id, personId: shift.personId, respondedAt: null },
      data: { respondedAt: new Date(), response: 'DECLINED' },
    }),
  ])

  await recordAs(shift.eventId, actor, `${shift.person.name} declined ${shift.role}`)

  return said(`${shift.person.name} can’t make ${shift.role} — it’s open again.`, 'warn')
}
