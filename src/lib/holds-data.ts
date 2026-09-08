import 'server-only'
import { db } from './db'
import {
  confirmRefusal,
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
 * Every mutation re-reads the ladder for the slot **inside a transaction** and
 * re-applies the rule there. The pure functions in holds.ts decide; this only
 * makes sure they decide against what is in the database at the moment of the
 * write, rather than against what the page rendered.
 *
 * That matters most for confirming: two coordinators confirming the same room
 * would both pass a check made before the transaction opened.
 */

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
  tx: Pick<typeof db, 'hold'>,
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
      canConfirm: confirmRefusal(ladder, h.id) === null,
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
  return db.$transaction(async (tx) => {
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
 */
export async function confirmHold(holdId: string): Promise<HoldOutcome> {
  return db.$transaction(async (tx) => {
    const hold = await tx.hold.findUnique({
      where: { id: holdId },
      select: { spaceId: true, date: true },
    })
    if (!hold) return { ok: false as const, why: 'That hold is no longer standing.' }

    const ladder = await ladderFor(tx, hold.spaceId, hold.date)
    const why = confirmRefusal(ladder, holdId)
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

/** Give up the night, and move everyone below up one. */
export async function releaseHold(holdId: string): Promise<HoldOutcome> {
  return db.$transaction(async (tx) => {
    const hold = await tx.hold.findUnique({
      where: { id: holdId },
      select: { spaceId: true, date: true, rank: true },
    })
    if (!hold) return { ok: false as const, why: 'That hold is no longer standing.' }

    const ladder = await ladderFor(tx, hold.spaceId, hold.date)
    const why = releaseRefusal(ladder, holdId)
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
 */
export async function challengeHold(holdId: string, byEventId: string): Promise<HoldOutcome> {
  return db.$transaction(async (tx) => {
    const mine = await tx.hold.findUnique({
      where: { id: holdId },
      select: { spaceId: true, date: true, rank: true, eventId: true },
    })
    if (!mine) return { ok: false as const, why: 'That hold is no longer standing.' }
    if (mine.rank === 1) {
      return {
        ok: false as const,
        why: 'You already hold this night first — nothing to challenge.',
      }
    }

    const ladder = await ladderFor(tx, mine.spaceId, mine.date)
    const first = ladder.find((h) => h.rank === 1 && h.state === 'held')
    if (!first) return { ok: false as const, why: 'There is no standing hold above yours.' }

    await tx.hold.update({
      where: { id: first.id },
      data: { challengedByEventId: byEventId, challengedAt: new Date() },
    })
    return { ok: true as const }
  })
}
