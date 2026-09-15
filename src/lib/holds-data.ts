import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { db } from './db'
import {
  ALREADY_CONFIRMED,
  challengeRefusal,
  confirmRefusal,
  firstHold,
  isDoubleBooking,
  NO_LONGER_STANDING,
  retryOnConflict,
  holdLabel,
  nextRank,
  placeRefusal,
  promoteAfterRelease,
  releaseRefusal,
  type HoldRow,
} from './holds'

/**
 * Reading and writing the hold ladder.
 *
 * Every mutation re-reads the ladder for the slot inside a **Serializable**
 * transaction and re-applies the rule there. The pure functions in holds.ts
 * decide; this makes sure they decide against the database at the moment of
 * the write rather than against what the page rendered.
 *
 * Serializable, not the default READ COMMITTED, because the default was
 * measured to be unsafe. Two concurrent placements on a free night both read
 * an empty ladder and both took rank 1; confirming both at once then
 * double-booked the room once in 40 races and crashed the loser with a
 * deadlock in the other 39. Serializable turns those into P2034 aborts,
 * `retryOnConflict` re-runs the loser against the committed ladder, and it is
 * refused in words.
 *
 * The partial unique index `Hold_one_confirmed_per_night` stays underneath as
 * the guarantee that does not depend on this file being right.
 */

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }

/** A hold-ladder transaction: Serializable, and re-run if Postgres aborts it for a conflict. */
function ladderTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return retryOnConflict(() => db.$transaction(fn, SERIALIZABLE))
}

const toRow = (h: {
  id: string
  eventId: string
  rank: number
  state: string
  challengedByEventId: string | null
}): HoldRow => ({
  id: h.id,
  eventId: h.eventId,
  rank: h.rank,
  state: h.state.toLowerCase() as HoldRow['state'],
  challengedByEventId: h.challengedByEventId,
})

const SLOT_SELECT = {
  id: true,
  eventId: true,
  rank: true,
  state: true,
  challengedByEventId: true,
} as const

/** Everything standing on one room for one night, oldest rank first. */
async function ladderFor(
  tx: Pick<Prisma.TransactionClient, 'hold'>,
  spaceId: string,
  date: Date,
): Promise<HoldRow[]> {
  const rows = await tx.hold.findMany({
    where: { spaceId, date },
    select: SLOT_SELECT,
    orderBy: { rank: 'asc' },
  })
  return rows.map(toRow)
}

/**
 * Where one of this event's holds sits, or null.
 *
 * The hold id arrives from the browser; the event id is the one the action
 * scoped. The scope goes into the query, the way `requireEvent` scopes an
 * event, so another event's hold comes back exactly like a hold that is not
 * there and its night is never read. The refusals in holds.ts check ownership
 * again against the ladder, so this query is not the only thing standing
 * between a foreign id and a write.
 */
function ownSlot(tx: Pick<Prisma.TransactionClient, 'hold'>, holdId: string, eventId: string) {
  return tx.hold.findUnique({
    where: { id: holdId, eventId },
    select: { spaceId: true, date: true, rank: true },
  })
}

export interface HoldView {
  id: string
  date: Date
  spaceName: string
  rank: number
  label: string
  state: HoldRow['state']
  /** Set when another event is waiting on this hold. */
  challengedBy: string | null
  /** True when this event's hold is the one that may confirm. */
  canConfirm: boolean
}

/** The holds this event has, with what can be done to each. */
export async function holdsForEvent(eventId: string): Promise<HoldView[]> {
  const mine = await db.hold.findMany({
    where: { eventId },
    select: {
      ...SLOT_SELECT,
      date: true,
      spaceId: true,
      space: { select: { name: true } },
      challengedAt: true,
    },
    orderBy: { date: 'asc' },
  })

  const views: HoldView[] = []
  for (const h of mine) {
    const ladder = await ladderFor(db, h.spaceId, h.date)
    const challenger = h.challengedByEventId
      ? await db.event.findUnique({
          where: { id: h.challengedByEventId },
          select: { name: true },
        })
      : null

    views.push({
      id: h.id,
      date: h.date,
      spaceName: h.space.name,
      rank: h.rank,
      label: holdLabel(h.rank),
      state: toRow(h).state,
      challengedBy: challenger?.name ?? null,
      canConfirm: confirmRefusal(ladder, h.id, eventId) === null,
    })
  }
  return views
}

export type HoldOutcome = { ok: true } | { ok: false; why: string }

export async function placeHold(
  eventId: string,
  spaceId: string,
  date: Date,
): Promise<HoldOutcome> {
  return ladderTransaction(async (tx) => {
    const ladder = await ladderFor(tx, spaceId, date)
    const why = placeRefusal(ladder, eventId)
    if (why) return { ok: false as const, why }

    await tx.hold.create({
      data: { eventId, spaceId, date, rank: nextRank(ladder) },
    })
    return { ok: true as const }
  })
}

/**
 * Take the night.
 *
 * Every other hold on the slot is released in the same transaction — they lost
 * the date the moment this one took it, and leaving them standing would show
 * two events holding a room that only one of them has.
 *
 * `eventId` is the event the caller was scoped to; a hold that is not its own
 * is refused as gone.
 */
export async function confirmHold(holdId: string, eventId: string): Promise<HoldOutcome> {
  try {
    return await confirmInside(holdId, eventId)
  } catch (err) {
    // Lost a race: another confirmation for this night committed between our
    // read and our write, and the index refused ours. Same words as the
    // refusal a moment later would have given.
    if (isDoubleBooking(err)) return { ok: false, why: ALREADY_CONFIRMED }
    throw err
  }
}

function confirmInside(holdId: string, eventId: string): Promise<HoldOutcome> {
  return ladderTransaction(async (tx) => {
    const hold = await ownSlot(tx, holdId, eventId)
    if (!hold) return { ok: false as const, why: NO_LONGER_STANDING }

    const ladder = await ladderFor(tx, hold.spaceId, hold.date)
    const why = confirmRefusal(ladder, holdId, eventId)
    if (why) return { ok: false as const, why }

    await tx.hold.update({
      where: { id: holdId },
      data: { state: 'CONFIRMED', challengedByEventId: null, challengedAt: null },
    })
    await tx.hold.updateMany({
      where: { spaceId: hold.spaceId, date: hold.date, state: 'HELD', id: { not: holdId } },
      data: { state: 'RELEASED', releasedAt: new Date() },
    })
    return { ok: true as const }
  })
}

/** Give up the night, and move everyone below up one. Only the event's own hold. */
export async function releaseHold(holdId: string, eventId: string): Promise<HoldOutcome> {
  return ladderTransaction(async (tx) => {
    const hold = await ownSlot(tx, holdId, eventId)
    if (!hold) return { ok: false as const, why: NO_LONGER_STANDING }

    const ladder = await ladderFor(tx, hold.spaceId, hold.date)
    const why = releaseRefusal(ladder, holdId, eventId)
    if (why) return { ok: false as const, why }

    await tx.hold.update({
      where: { id: holdId },
      data: { state: 'RELEASED', releasedAt: new Date(), challengedByEventId: null },
    })

    for (const move of promoteAfterRelease(ladder, hold.rank)) {
      await tx.hold.update({ where: { id: move.id }, data: { rank: move.rank } })
    }
    return { ok: true as const }
  })
}

/**
 * Challenge the hold above yours.
 *
 * This is the only thing that makes a stale hold move, because nothing
 * expires. It marks the 1st hold as challenged and names who is waiting; the
 * incumbent then confirms or releases.
 *
 * `eventId` is both the event that owns the lower hold and the one named as
 * waiting, so a challenge only ever goes out in the name of the event queued
 * behind.
 */
export async function challengeHold(holdId: string, eventId: string): Promise<HoldOutcome> {
  return ladderTransaction(async (tx) => {
    const mine = await ownSlot(tx, holdId, eventId)
    if (!mine) return { ok: false as const, why: NO_LONGER_STANDING }

    const ladder = await ladderFor(tx, mine.spaceId, mine.date)
    const why = challengeRefusal(ladder, holdId, eventId)
    if (why) return { ok: false as const, why }

    // challengeRefusal has just found a 1st hold standing.
    await tx.hold.update({
      where: { id: firstHold(ladder)!.id },
      data: { challengedByEventId: eventId, challengedAt: new Date() },
    })
    return { ok: true as const }
  })
}
