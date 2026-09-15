import { describe, expect, it } from 'vitest'
import {
  ALREADY_CONFIRMED,
  challengeRefusal,
  confirmRefusal,
  firstHold,
  isDoubleBooking,
  isWriteConflict,
  NO_LONGER_STANDING,
  retryOnConflict,
  holdLabel,
  nextRank,
  placeRefusal,
  promoteAfterRelease,
  releaseRefusal,
  type HoldRow,
  type HoldState,
} from './holds'

/**
 * Holds on a room for a night.
 *
 * The venue had no availability model at all: an event carried one date and
 * one space, and nothing anywhere checked whether the room was already taken.
 * Two coordinators could book the Main Room twice on a Saturday and both rows
 * would show, cheerfully, on the pipeline.
 *
 * The ladder is challenge-driven and has no clock, by decision. A hold stands
 * until somebody wants the date; challenging it forces the incumbent to
 * confirm or release. Nothing expires on a timer, so there is no background
 * job and no hold that quietly evaporates while a promoter thinks they have
 * the room.
 */

const hold = (over: Partial<HoldRow> = {}): HoldRow => ({
  id: 'h1',
  eventId: 'e1',
  rank: 1,
  state: 'held',
  challengedByEventId: null,
  ...over,
})

describe('nextRank', () => {
  it('gives the first hold on a free night rank 1', () => {
    expect(nextRank([])).toBe(1)
  })

  it('queues behind the holds already there', () => {
    expect(nextRank([hold({ rank: 1 })])).toBe(2)
    expect(nextRank([hold({ id: 'a', rank: 1 }), hold({ id: 'b', rank: 2 })])).toBe(3)
  })

  it('ignores released holds when working out the next rank', () => {
    // A released hold is out of the queue, so its number is free again.
    const holds = [hold({ id: 'a', rank: 1, state: 'released' }), hold({ id: 'b', rank: 2 })]
    expect(nextRank(holds)).toBe(3)
  })
})

describe('holdLabel', () => {
  it('reads the way the room is actually spoken about', () => {
    expect(holdLabel(1)).toBe('1st hold')
    expect(holdLabel(2)).toBe('2nd hold')
    expect(holdLabel(3)).toBe('3rd hold')
    expect(holdLabel(4)).toBe('4th hold')
  })
})

describe('placeRefusal', () => {
  it('allows a hold on a night nobody has confirmed', () => {
    expect(placeRefusal([hold()], 'e2')).toBeNull()
  })

  /**
   * The bug this whole feature exists for. Nothing used to stop a second
   * event being booked into a room that was already taken.
   */
  it('refuses a hold on a night already confirmed, and names what has it', () => {
    const taken = [hold({ state: 'confirmed', eventId: 'e9' })]
    expect(placeRefusal(taken, 'e2')).toContain('already confirmed')
  })

  it('refuses a second hold from an event that already holds the night', () => {
    expect(placeRefusal([hold({ eventId: 'e1' })], 'e1')).toContain('already holds')
  })
})

describe('confirmRefusal', () => {
  it('lets the first hold confirm', () => {
    expect(confirmRefusal([hold({ rank: 1 })], 'h1', 'e1')).toBeNull()
  })

  /**
   * Right of first refusal. A second hold cannot step over the first — it
   * challenges, and the first either takes the date or gives it up.
   */
  it('refuses a lower hold that has not been given the date', () => {
    const holds = [hold({ id: 'a', rank: 1 }), hold({ id: 'b', eventId: 'e2', rank: 2 })]
    expect(confirmRefusal(holds, 'b', 'e2')).toContain('1st hold')
  })

  it('refuses confirming into a night somebody else already confirmed', () => {
    const holds = [
      hold({ id: 'a', eventId: 'e9', rank: 1, state: 'confirmed' }),
      hold({ id: 'b', rank: 2 }),
    ]
    expect(confirmRefusal(holds, 'b', 'e1')).toContain('already confirmed')
  })

  it('refuses a hold that is not there', () => {
    expect(confirmRefusal([hold()], 'nope', 'e1')).toBe(NO_LONGER_STANDING)
  })

  /**
   * The hold id arrives from the browser, so it can name any hold on any
   * night. Confirming another event's 1st hold would take that event's room
   * and release every other hold on the night, from a page that was only ever
   * scoped to this one.
   */
  it("refuses another event's hold, even a 1st hold that could confirm", () => {
    const theirs = [hold({ id: 'h1', eventId: 'e2', rank: 1 })]
    expect(confirmRefusal(theirs, 'h1', 'e1')).toBe(NO_LONGER_STANDING)
  })
})

describe('releaseRefusal', () => {
  it('lets a live hold go', () => {
    expect(releaseRefusal([hold()], 'h1', 'e1')).toBeNull()
  })

  it('refuses to release a hold that has already become the booking', () => {
    // Releasing a confirmed booking is a cancellation, which is a different
    // act with different consequences — it does not happen by this door.
    expect(releaseRefusal([hold({ state: 'confirmed' })], 'h1', 'e1')).toContain('confirmed')
  })

  it('refuses a hold that is not there', () => {
    expect(releaseRefusal([hold()], 'nope', 'e1')).toBe(NO_LONGER_STANDING)
  })

  /** Letting another event's hold go would move everyone behind it up a place. */
  it("refuses another event's hold, even a live one", () => {
    expect(releaseRefusal([hold({ eventId: 'e2' })], 'h1', 'e1')).toBe(NO_LONGER_STANDING)
  })
})

describe('challengeRefusal', () => {
  /** One event holding the night first, and another waiting behind it. */
  const night = [
    hold({ id: 'first', eventId: 'e1', rank: 1 }),
    hold({ id: 'second', eventId: 'e2', rank: 2 }),
  ]

  it('lets a lower hold challenge the 1st', () => {
    expect(challengeRefusal(night, 'second', 'e2')).toBeNull()
  })

  it('refuses the 1st hold, which has nothing above it to challenge', () => {
    expect(challengeRefusal(night, 'first', 'e1')).toContain('nothing to challenge')
  })

  it('refuses when nothing above it is still standing', () => {
    const noneAbove = [
      hold({ id: 'first', eventId: 'e1', rank: 1, state: 'released' }),
      hold({ id: 'second', eventId: 'e2', rank: 2 }),
    ]
    expect(challengeRefusal(noneAbove, 'second', 'e2')).toContain('no standing hold above')
  })

  it('refuses a hold that is not there', () => {
    expect(challengeRefusal(night, 'nope', 'e2')).toBe(NO_LONGER_STANDING)
  })

  /**
   * A challenge names the event that is waiting. Made with another event's
   * lower hold, it would put the incumbent on notice in the name of an event
   * that is not queued for the night at all.
   */
  it("refuses another event's lower hold, so nobody challenges in its place", () => {
    expect(challengeRefusal(night, 'second', 'e3')).toBe(NO_LONGER_STANDING)
  })

  /** A released hold has given the night up, so it is not waiting on anything. */
  it('refuses a hold that has been released', () => {
    const gaveUp = [
      hold({ id: 'first', eventId: 'e1', rank: 1 }),
      hold({ id: 'second', eventId: 'e2', rank: 2, state: 'released' }),
    ]
    expect(challengeRefusal(gaveUp, 'second', 'e2')).toBe(NO_LONGER_STANDING)
  })
})

describe('firstHold', () => {
  it('is the hold standing at rank 1', () => {
    const holds = [hold({ id: 'a', rank: 1 }), hold({ id: 'b', eventId: 'e2', rank: 2 })]
    expect(firstHold(holds)?.id).toBe('a')
  })

  it('is not a released hold that kept its old number', () => {
    // Released rows keep their rank so the history reads correctly. The
    // number alone does not make a hold first.
    expect(firstHold([hold({ rank: 1, state: 'released' })])).toBeUndefined()
  })
})

describe('NO_LONGER_STANDING', () => {
  /**
   * One sentence for a hold that is gone and a hold that was never this
   * event's to touch. Anything more particular — that it is confirmed, or
   * released, or first — would describe another event's night to somebody
   * with no business seeing it, and would tell them the id they sent is real.
   */
  const rules = { confirmRefusal, releaseRefusal, challengeRefusal }
  const states: HoldState[] = ['held', 'released', 'confirmed']

  /** Two other events on the night; the caller, e1, is not one of them. */
  const theirs = (state: HoldState): HoldRow[] => [
    hold({ id: 'first', eventId: 'e2', rank: 1, state }),
    hold({ id: 'second', eventId: 'e3', rank: 2 }),
  ]

  describe.each(Object.entries(rules))('%s', (_, rule) => {
    it('is what it says of a hold that is not there', () => {
      expect(rule(theirs('held'), 'nope', 'e1')).toBe(NO_LONGER_STANDING)
    })

    it.each(states)("is all it says of another event's hold when that hold is %s", (state) => {
      expect(rule(theirs(state), 'first', 'e1')).toBe(NO_LONGER_STANDING)
      expect(rule(theirs(state), 'second', 'e1')).toBe(NO_LONGER_STANDING)
    })
  })
})

describe('promoteAfterRelease', () => {
  it('moves everyone below the released hold up one', () => {
    const holds = [
      hold({ id: 'a', rank: 1 }),
      hold({ id: 'b', rank: 2 }),
      hold({ id: 'c', rank: 3 }),
    ]
    expect(promoteAfterRelease(holds, 1)).toEqual([
      { id: 'b', rank: 1 },
      { id: 'c', rank: 2 },
    ])
  })

  it('leaves holds above the released one alone', () => {
    const holds = [
      hold({ id: 'a', rank: 1 }),
      hold({ id: 'b', rank: 2 }),
      hold({ id: 'c', rank: 3 }),
    ]
    expect(promoteAfterRelease(holds, 2)).toEqual([{ id: 'c', rank: 2 }])
  })

  it('does not promote released holds', () => {
    const holds = [
      hold({ id: 'a', rank: 1 }),
      hold({ id: 'b', rank: 2, state: 'released' }),
      hold({ id: 'c', rank: 3 }),
    ]
    expect(promoteAfterRelease(holds, 1)).toEqual([{ id: 'c', rank: 2 }])
  })

  it('has nothing to do when the last hold goes', () => {
    expect(promoteAfterRelease([hold({ rank: 1 })], 1)).toEqual([])
  })
})

describe('isDoubleBooking', () => {
  /**
   * The refusals above run inside a transaction, but two coordinators
   * confirming the same free night at the same moment can both read an empty
   * slot. The database index `Hold_one_confirmed_per_night` catches that
   * second write — this recognises its error so the loser is told why, rather
   * than shown a crash.
   *
   * The shape below was captured from Prisma 7.10 with the pg driver adapter
   * by triggering the violation for real. It is not the classic `meta.target`
   * shape, which is exactly why it was captured rather than assumed.
   */
  const violation = (index: string) => ({
    name: 'PrismaClientKnownRequestError',
    code: 'P2002',
    meta: {
      modelName: 'Hold',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23505',
          kind: 'UniqueConstraintViolation',
          constraint: { index },
          table: 'Hold',
        },
      },
    },
  })

  it('recognises the one-confirmed-per-night index rejecting a write', () => {
    expect(isDoubleBooking(violation('Hold_one_confirmed_per_night'))).toBe(true)
  })

  it('ignores a unique violation on some other index', () => {
    // A different constraint failing is a different bug, and must not be
    // reported to a coordinator as "the night is taken".
    expect(isDoubleBooking(violation('Hold_pkey'))).toBe(false)
  })

  it('ignores errors that are not unique violations', () => {
    expect(isDoubleBooking({ code: 'P2025', meta: {} })).toBe(false)
    expect(isDoubleBooking(new Error('connection refused'))).toBe(false)
  })

  it('does not throw on things that are not errors at all', () => {
    expect(isDoubleBooking(null)).toBe(false)
    expect(isDoubleBooking(undefined)).toBe(false)
    expect(isDoubleBooking('P2002')).toBe(false)
  })
})

describe('ALREADY_CONFIRMED', () => {
  it('is the sentence both the refusal and the race report use', () => {
    // One sentence, so a coordinator who loses a race reads the same words as
    // one who was refused a moment later.
    expect(placeRefusal([hold({ state: 'confirmed', eventId: 'e9' })], 'e2')).toBe(
      ALREADY_CONFIRMED,
    )
    expect(confirmRefusal([hold({ id: 'a', state: 'confirmed' })], 'a', 'e1')).toBe(
      ALREADY_CONFIRMED,
    )
  })
})

describe('isWriteConflict', () => {
  it('recognises Postgres aborting a transaction for a conflict or deadlock', () => {
    expect(isWriteConflict({ code: 'P2034' })).toBe(true)
  })

  /**
   * The second shape. A Serializable transaction that loses — two placements
   * both reading an empty night — does not come back as P2034 at all. The pg
   * adapter throws its own error with no `code`, carrying the SQLSTATE in
   * `cause`. Captured from a real concurrent placement; the first version of
   * this check matched only P2034 and let 38 of 40 such races crash.
   */
  it('recognises the serialization failure the adapter throws itself, which has no code', () => {
    const serialization = Object.assign(new Error('TransactionWriteConflict'), {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '40001',
        originalMessage:
          'could not serialize access due to read/write dependencies among transactions',
        kind: 'TransactionWriteConflict',
      },
    })
    expect(isWriteConflict(serialization)).toBe(true)
  })

  it('does not treat other adapter errors as retryable', () => {
    const other = Object.assign(new Error('UniqueConstraintViolation'), {
      name: 'DriverAdapterError',
      cause: { originalCode: '23505', kind: 'UniqueConstraintViolation' },
    })
    expect(isWriteConflict(other)).toBe(false)
  })

  it('does not treat other errors as retryable', () => {
    expect(isWriteConflict({ code: 'P2002' })).toBe(false)
    expect(isWriteConflict(new Error('boom'))).toBe(false)
    expect(isWriteConflict(null)).toBe(false)
  })
})

/**
 * Two coordinators confirming the same night used to deadlock: each confirmed
 * its own hold, then tried to release the other's, and Postgres aborted one of
 * them with P2034 — a 500 page for whoever lost. Measured, not assumed: 39 of
 * 40 concurrent races crashed the loser, and one in 40 double-booked the room.
 *
 * Retrying is Postgres's own advice for P2034. On the second attempt the loser
 * re-reads the ladder, finds the night confirmed, and gets the refusal.
 */
describe('retryOnConflict', () => {
  const conflict = Object.assign(new Error('write conflict'), { code: 'P2034' })

  it('returns the first attempt that does not conflict', async () => {
    let calls = 0
    const out = await retryOnConflict(async () => {
      calls++
      if (calls < 3) throw conflict
      return 'booked'
    })
    expect(out).toBe('booked')
    expect(calls).toBe(3)
  })

  it('gives up after the attempt limit and surfaces the conflict', async () => {
    let calls = 0
    await expect(
      retryOnConflict(async () => {
        calls++
        throw conflict
      }, 3),
    ).rejects.toBe(conflict)
    expect(calls).toBe(3)
  })

  it('does not retry an error that retrying cannot fix', async () => {
    let calls = 0
    const other = Object.assign(new Error('unique'), { code: 'P2002' })
    await expect(
      retryOnConflict(async () => {
        calls++
        throw other
      }),
    ).rejects.toBe(other)
    expect(calls).toBe(1)
  })
})
