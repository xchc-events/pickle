import { dateLabel } from './format'

/**
 * Holds on a room for a night.
 *
 * Before this the venue had no availability model: an `Event` carried one
 * `date` and one `spaceId`, and nothing anywhere checked whether the room was
 * already taken. Two coordinators could book the Main Room twice on the same
 * Saturday and both rows would show on the pipeline.
 *
 * The ladder is **challenge-driven and has no clock**, by decision. A hold
 * stands until somebody else wants the date; challenging it forces the
 * incumbent to confirm or release. Nothing expires on a timer — so there is no
 * background job, and no hold quietly evaporates while a promoter believes
 * they still have the room.
 *
 * Everything here is pure over plain shapes so the whole ladder can be tested
 * without a database. The refusals return the sentence the coordinator will
 * read rather than a boolean, so the rule and its wording cannot drift.
 */

export type HoldState = 'held' | 'released' | 'confirmed'

export interface HoldRow {
  id: string
  eventId: string
  /** 1 = first hold. Only meaningful while `state` is 'held'. */
  rank: number
  state: HoldState
  /** The event waiting on this hold, once it has been challenged. */
  challengedByEventId: string | null
}

/**
 * What a coordinator reads when the night has gone to someone else — whether
 * a refusal caught it first or the database index caught a race.
 */
export const ALREADY_CONFIRMED = 'That night is already confirmed for another event.'

/**
 * What a coordinator reads for a hold that is gone — and for one that was
 * never their event's to touch.
 *
 * The hold id arrives from the browser, so it can name any hold on any night.
 * The two cases share one sentence, said before anything about the hold's
 * state, so an id off another event's ladder tells the caller nothing about
 * that ladder — not even that the id is real.
 */
export const NO_LONGER_STANDING = 'That hold is no longer standing.'

/** The partial unique index added in `20260915000000_hold_one_confirmed_per_night`. */
export const ONE_CONFIRMED_INDEX = 'Hold_one_confirmed_per_night'

const live = (holds: HoldRow[]): HoldRow[] => holds.filter((h) => h.state === 'held')
const confirmed = (holds: HoldRow[]): HoldRow | undefined =>
  holds.find((h) => h.state === 'confirmed')

/** The hold, if it is on this ladder and belongs to this event. */
const ownHold = (holds: HoldRow[], holdId: string, eventId: string): HoldRow | undefined =>
  holds.find((h) => h.id === holdId && h.eventId === eventId)

/**
 * The hold with first refusal on the night, if one is standing.
 *
 * Standing, not just numbered 1: a released hold keeps its old rank so the
 * history stays readable.
 */
export function firstHold(holds: HoldRow[]): HoldRow | undefined {
  return live(holds).find((h) => h.rank === 1)
}

/** "1st hold", "2nd hold", "3rd hold" — how the room is actually spoken about. */
export function holdLabel(rank: number): string {
  const tens = rank % 100
  const ones = rank % 10
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : ones === 1
        ? 'st'
        : ones === 2
          ? 'nd'
          : ones === 3
            ? 'rd'
            : 'th'
  return `${rank}${suffix} hold`
}

/** The rank a new hold joins at — behind every hold still standing. */
export function nextRank(holds: HoldRow[]): number {
  const ranks = live(holds).map((h) => h.rank)
  return ranks.length === 0 ? 1 : Math.max(...ranks) + 1
}

/** Why a new hold cannot be placed on this night, or null if it can. */
export function placeRefusal(holds: HoldRow[], eventId: string): string | null {
  const taken = confirmed(holds)
  if (taken) return ALREADY_CONFIRMED
  if (live(holds).some((h) => h.eventId === eventId)) {
    return 'This event already holds that night.'
  }
  return null
}

/**
 * Why a hold cannot become the booking, or null if it can.
 *
 * Only the first hold may confirm. That is right of first refusal, and it is
 * the reason ranking exists at all: a second hold does not step over a first,
 * it challenges, and the first either takes the date or gives it up.
 *
 * `eventId` is the event the caller was scoped to, and only its own hold can
 * confirm. Anyone else's is refused as gone before the night is looked at —
 * confirming it would take that event's room and release every other hold on
 * the night.
 */
export function confirmRefusal(holds: HoldRow[], holdId: string, eventId: string): string | null {
  const hold = ownHold(holds, holdId, eventId)
  if (!hold) return NO_LONGER_STANDING

  const taken = confirmed(holds)
  if (taken) return ALREADY_CONFIRMED

  if (hold.state !== 'held') return NO_LONGER_STANDING

  if (hold.rank !== 1) {
    return firstHold(holds)
      ? 'The 1st hold has first refusal — challenge it rather than booking over it.'
      : 'That hold is not the 1st hold.'
  }
  return null
}

/**
 * Why a hold cannot be released, or null if it can.
 *
 * Only by the event it belongs to: letting somebody else's hold go would move
 * everyone behind it up a place on a night that is not this event's to rearrange.
 */
export function releaseRefusal(holds: HoldRow[], holdId: string, eventId: string): string | null {
  const hold = ownHold(holds, holdId, eventId)
  if (!hold) return NO_LONGER_STANDING
  if (hold.state === 'confirmed') {
    // Releasing a confirmed booking is a cancellation — a different act, with
    // different consequences, that does not happen by this door.
    return 'That night is confirmed. Cancelling a booking is not the same as dropping a hold.'
  }
  if (hold.state === 'released') return 'That hold has already been released.'
  return null
}

/**
 * Why a hold cannot challenge the 1st hold on its night, or null if it can.
 *
 * A challenge puts the incumbent on notice and names who is waiting, and the
 * one named is the event asking. So the lower hold has to be that event's own:
 * with somebody else's, any event could put a night's incumbent on notice in
 * its own name without being queued for the night at all. A released hold has
 * given the night up and is not waiting on anything, so it cannot challenge
 * either.
 */
export function challengeRefusal(holds: HoldRow[], holdId: string, eventId: string): string | null {
  const hold = ownHold(holds, holdId, eventId)
  if (!hold || hold.state === 'released') return NO_LONGER_STANDING
  if (hold.rank === 1) return 'You already hold this night first — nothing to challenge.'
  if (!firstHold(holds)) return 'There is no standing hold above yours.'
  return null
}

/**
 * The re-ranking after a hold at `releasedRank` goes.
 *
 * Returns only the holds that move, so the caller writes the smallest update
 * it can rather than rewriting the whole ladder — and whose each one is, so
 * the events that moved up can be told.
 */
export function promoteAfterRelease(
  holds: HoldRow[],
  releasedRank: number,
): { id: string; eventId: string; rank: number }[] {
  return live(holds)
    .filter((h) => h.rank > releasedRank)
    .sort((a, b) => a.rank - b.rank)
    .map((h) => ({ id: h.id, eventId: h.eventId, rank: h.rank - 1 }))
}

/**
 * What a write did to a hold that belongs to another event.
 *
 * - `released`: the night was confirmed for another event.
 * - `moved_up`: a hold above it was released.
 * - `challenged`: it is the 1st hold, and a hold below it challenged.
 */
export type HoldChange = 'released' | 'moved_up' | 'challenged'

/**
 * A hold of another event that a confirmation, release or challenge changed.
 *
 * Every mutation writes to the activity table, and these change more than the
 * acting event's own hold, so the writer reports them and the action writes a
 * line on each of their events too. It carries no event name, and `affectedLine`
 * takes none — see there for why.
 */
export interface AffectedHold {
  holdId: string
  eventId: string
  change: HoldChange
  /** The rank it was released from, moved up to, or challenged at. */
  rank: number
  spaceName: string
  date: Date
}

/**
 * The holds a write changed that belong to other events, in ladder order.
 *
 * The acting event's own holds are left out, because the action writes its own
 * line about the act. One hold to a night per event means that should not come
 * up, but nothing in the table forbids a second — and a line saying "another
 * event" did it would then be wrong about itself.
 */
export function affectedHolds(
  changed: { id: string; eventId: string; rank: number }[],
  change: HoldChange,
  night: { spaceName: string; date: Date },
  actingEventId: string,
): AffectedHold[] {
  return changed
    .filter((h) => h.eventId !== actingEventId)
    .sort((a, b) => a.rank - b.rank)
    .map((h) => ({
      holdId: h.id,
      eventId: h.eventId,
      change,
      rank: h.rank,
      spaceName: night.spaceName,
      date: night.date,
    }))
}

/**
 * The activity line on the event whose hold was changed. It follows the
 * initials of whoever made the write, like every other line.
 *
 * It says "another event", never which. A promoter reads the feed of their own
 * events, and another organisation's event is not theirs to see — the reason
 * the event page does not load the ladder for them at all. The feed is
 * append-only, so a name written here could never be taken back.
 */
export function affectedLine(hold: AffectedHold): string {
  const where = `${hold.spaceName} for ${dateLabel(hold.date)}`
  const label = holdLabel(hold.rank)
  switch (hold.change) {
    case 'released':
      return `confirmed the night for another event — this event's ${label} on ${where} was released`
    case 'moved_up':
      return `released a hold above this one — this event is now the ${label} on ${where}`
    case 'challenged':
      return `challenged this event's ${label} on ${where} — it has to take the night or give it up`
  }
}

/**
 * Whether an error is the database refusing a second confirmed hold.
 *
 * The refusals above run inside a transaction, but under READ COMMITTED two
 * coordinators confirming the same free night at once can both read an empty
 * slot. The index catches the second write; this recognises its error so the
 * loser is told the night is taken rather than shown a crash.
 *
 * Duck-typed rather than importing Prisma, so it stays pure and testable. The
 * shape is Prisma 7.10 with the pg driver adapter, captured by triggering the
 * violation for real — it is not the classic `meta.target` shape. Matching on
 * the index name, not on P2002 alone, keeps an unrelated unique violation from
 * being reported to a coordinator as "the night is taken".
 */
export function isDoubleBooking(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as {
    code?: unknown
    meta?: { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } }
  }
  return (
    e.code === 'P2002' &&
    e.meta?.driverAdapterError?.cause?.constraint?.index === ONE_CONFIRMED_INDEX
  )
}

/**
 * Whether Postgres aborted a transaction for a write conflict or deadlock.
 *
 * It arrives in two shapes, both captured from real races rather than read
 * off documentation:
 *
 *   - A deadlock comes back through Prisma as `code: 'P2034'`.
 *   - A Serializable transaction that loses comes back as the pg adapter's own
 *     `DriverAdapterError`, with no `code` at all and SQLSTATE 40001 under
 *     `cause.kind: 'TransactionWriteConflict'`.
 *
 * Matching only the first let 38 of 40 concurrent placements crash.
 */
export function isWriteConflict(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: unknown; cause?: { kind?: unknown } }
  return e.code === 'P2034' || e.cause?.kind === 'TransactionWriteConflict'
}

/**
 * Run a transaction again when Postgres aborts it for a conflict.
 *
 * The retried attempt reads the ladder afresh, so the loser of a race sees
 * the night already confirmed and is refused in words rather than crashed.
 * Bounded, because a conflict that survives three attempts is not a race any
 * more and should be seen rather than looped over.
 */
export async function retryOnConflict<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (!isWriteConflict(err) || i >= attempts) throw err
    }
  }
}
