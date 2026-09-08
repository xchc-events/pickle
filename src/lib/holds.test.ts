import { describe, expect, it } from 'vitest'
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
    expect(confirmRefusal([hold({ rank: 1 })], 'h1')).toBeNull()
  })

  /**
   * Right of first refusal. A second hold cannot step over the first — it
   * challenges, and the first either takes the date or gives it up.
   */
  it('refuses a lower hold that has not been given the date', () => {
    const holds = [hold({ id: 'a', rank: 1 }), hold({ id: 'b', rank: 2 })]
    expect(confirmRefusal(holds, 'b')).toContain('1st hold')
  })

  it('refuses confirming into a night somebody else already confirmed', () => {
    const holds = [hold({ id: 'a', rank: 1, state: 'confirmed' }), hold({ id: 'b', rank: 2 })]
    expect(confirmRefusal(holds, 'b')).toContain('already confirmed')
  })

  it('refuses a hold that is not there', () => {
    expect(confirmRefusal([hold()], 'nope')).not.toBeNull()
  })
})

describe('releaseRefusal', () => {
  it('lets a live hold go', () => {
    expect(releaseRefusal([hold()], 'h1')).toBeNull()
  })

  it('refuses to release a hold that has already become the booking', () => {
    // Releasing a confirmed booking is a cancellation, which is a different
    // act with different consequences — it does not happen by this door.
    expect(releaseRefusal([hold({ state: 'confirmed' })], 'h1')).toContain('confirmed')
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
