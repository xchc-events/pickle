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

/** The partial unique index added in `20260915000000_hold_one_confirmed_per_night`. */
export const ONE_CONFIRMED_INDEX = 'Hold_one_confirmed_per_night'

const live = (holds: HoldRow[]): HoldRow[] => holds.filter((h) => h.state === 'held')
const confirmed = (holds: HoldRow[]): HoldRow | undefined =>
  holds.find((h) => h.state === 'confirmed')

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
 */
export function confirmRefusal(holds: HoldRow[], holdId: string): string | null {
  const taken = confirmed(holds)
  if (taken) return ALREADY_CONFIRMED

  const hold = holds.find((h) => h.id === holdId)
  if (!hold || hold.state !== 'held') return 'That hold is no longer standing.'

  if (hold.rank !== 1) {
    const first = live(holds).find((h) => h.rank === 1)
    return first
      ? 'The 1st hold has first refusal — challenge it rather than booking over it.'
      : 'That hold is not the 1st hold.'
  }
  return null
}

/** Why a hold cannot be released, or null if it can. */
export function releaseRefusal(holds: HoldRow[], holdId: string): string | null {
  const hold = holds.find((h) => h.id === holdId)
  if (!hold) return 'That hold is no longer standing.'
  if (hold.state === 'confirmed') {
    // Releasing a confirmed booking is a cancellation — a different act, with
    // different consequences, that does not happen by this door.
    return 'That night is confirmed. Cancelling a booking is not the same as dropping a hold.'
  }
  if (hold.state === 'released') return 'That hold has already been released.'
  return null
}

/**
 * The re-ranking after a hold at `releasedRank` goes.
 *
 * Returns only the holds that move, so the caller writes the smallest update
 * it can rather than rewriting the whole ladder.
 */
export function promoteAfterRelease(
  holds: HoldRow[],
  releasedRank: number,
): { id: string; rank: number }[] {
  return live(holds)
    .filter((h) => h.rank > releasedRank)
    .sort((a, b) => a.rank - b.rank)
    .map((h) => ({ id: h.id, rank: h.rank - 1 }))
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
