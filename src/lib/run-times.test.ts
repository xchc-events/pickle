import { describe, expect, it } from 'vitest'
import { nightOf } from './night'
import {
  MAX_NIGHTS,
  clockFromInput,
  clockToInput,
  endNightFor,
  minutesOfDay,
  runProblems,
  type RunTimes,
} from './run-times'

/**
 * When a night starts and ends.
 *
 * Times stay '8:00pm'-shaped strings — `timeMinutes` in event-record.ts, the
 * licence gate and the roster all read them that way — but any minute is now
 * allowed, so this covers the free `<input type="time">` parsing and the
 * rules that used to be enforced for free by three fixed pick-lists.
 */

describe('clockFromInput', () => {
  it.each([
    ['20:15', '8:15pm'],
    ['00:00', '12:00am'],
    ['12:00', '12:00pm'],
    ['00:05', '12:05am'],
    ['09:07', '9:07am'],
  ])('turns %s into %s', (input, label) => {
    expect(clockFromInput(input)).toBe(label)
  })

  it.each(['', '25:00', '8:15pm', '7:5'])('is null for %s', (input) => {
    expect(clockFromInput(input)).toBeNull()
  })
})

describe('clockToInput', () => {
  it.each([
    ['20:15', '8:15pm'],
    ['00:00', '12:00am'],
    ['12:00', '12:00pm'],
    ['00:05', '12:05am'],
    ['09:07', '9:07am'],
  ])('is the inverse of clockFromInput: %s from %s', (input, label) => {
    expect(clockToInput(label)).toBe(input)
  })

  it('is empty for null, undefined and garbage', () => {
    expect(clockToInput(null)).toBe('')
    expect(clockToInput(undefined)).toBe('')
    expect(clockToInput('garbage')).toBe('')
  })
})

describe('minutesOfDay', () => {
  it.each([
    ['12:00am', 0],
    ['1:00am', 60],
    ['11:59pm', 1439],
  ])('reads %s as %i minutes after midnight', (label, minutes) => {
    expect(minutesOfDay(label)).toBe(minutes)
  })

  it('is null for garbage', () => {
    expect(minutesOfDay('garbage')).toBeNull()
  })
})

describe('endNightFor', () => {
  const date = nightOf(2026, 8, 19)
  const nextNight = nightOf(2026, 8, 20)

  it('is the same night when everyone is out later in the day than doors open', () => {
    expect(endNightFor(date, '8:00pm', '11:30pm')).toEqual(date)
  })

  it('is the next night when everyone is out at or before the hour doors opened', () => {
    expect(endNightFor(date, '8:00pm', '1:00am')).toEqual(nextNight)
  })

  it('is the next night when doors and everyone-out read the same clock time', () => {
    expect(endNightFor(date, '2:00pm', '2:00pm')).toEqual(nextNight)
  })

  it('is null when a time is missing', () => {
    expect(endNightFor(date, null, '11:30pm')).toBeNull()
    expect(endNightFor(date, '8:00pm', null)).toBeNull()
  })

  describe('with pack-out', () => {
    const nightAfterNext = nightOf(2026, 8, 21)

    it('does not carry further when pack-out reads later in the day than everyone-out', () => {
      expect(endNightFor(date, '8:00pm', '1:00am', '3:00am')).toEqual(nextNight)
    })

    it('carries one night further when pack-out reads before everyone-out — past its own midnight', () => {
      expect(endNightFor(date, '8:00pm', '1:00am', '12:30am')).toEqual(nightAfterNext)
    })

    it('does not carry further when pack-out reads the same clock time as everyone-out — the same instant, not a day later', () => {
      expect(endNightFor(date, '8:00pm', '1:00am', '1:00am')).toEqual(nextNight)
    })

    it('is fine following a same-day everyone-out too — pack-out after it, same night', () => {
      expect(endNightFor(date, '2:00pm', '5:00pm', '6:00pm')).toEqual(date)
    })

    it('is unaffected by pack-out when there is no everyone-out to read it against', () => {
      expect(endNightFor(date, '8:00pm', null, '3:00am')).toBeNull()
    })

    it('is unaffected when pack-out is not set', () => {
      expect(endNightFor(date, '8:00pm', '11:30pm', null)).toEqual(date)
      expect(endNightFor(date, '8:00pm', '11:30pm')).toEqual(date)
    })
  })
})

describe('runProblems', () => {
  const date = nightOf(2026, 8, 19)
  const DAY = 86_400_000
  const base: RunTimes = { date, doors: null, barClose: null, allOut: null, endDate: null }

  it('is empty when nothing is decided yet', () => {
    expect(runProblems(base)).toEqual({})
  })

  it('is fine for a Saturday 8:00pm to Sunday 1:00am gig with a 12:00am bar close', () => {
    const endDate = nightOf(2026, 8, 20)
    expect(
      runProblems({ date, doors: '8:00pm', barClose: '12:00am', allOut: '1:00am', endDate }),
    ).toEqual({})
  })

  it('is fine for an afternoon 2:00pm-5:00pm workshop on one night with a 4:30pm bar close', () => {
    expect(
      runProblems({ date, doors: '2:00pm', barClose: '4:30pm', allOut: '5:00pm', endDate: date }),
    ).toEqual({})
  })

  it('is fine for a three-night festival, Fri 6:00pm to Sun 4:00pm, with a 1:00am bar close', () => {
    const endDate = nightOf(2026, 8, 21)
    expect(
      runProblems({ date, doors: '6:00pm', barClose: '1:00am', allOut: '4:00pm', endDate }),
    ).toEqual({})
  })

  it('refuses a bar close at the minute the doors open', () => {
    expect(runProblems({ ...base, doors: '8:00pm', barClose: '8:00pm' })).toEqual({
      barClose: 'The bar closes after the doors open and before everyone is out.',
    })
  })

  it('is fine when the bar closes exactly at the end', () => {
    expect(
      runProblems({ date, doors: '8:00pm', barClose: '11:30pm', allOut: '11:30pm', endDate: date }),
    ).toEqual({})
  })

  it('refuses a bar close after the end', () => {
    expect(
      runProblems({ date, doors: '8:00pm', barClose: '11:45pm', allOut: '11:30pm', endDate: date }),
    ).toEqual({
      barClose: 'The bar closes after the doors open and before everyone is out.',
    })
  })

  it('refuses an end before the start on the same night', () => {
    expect(
      runProblems({ date, doors: '11:00pm', barClose: null, allOut: '10:00pm', endDate: date }),
    ).toEqual({
      allOut: 'Everyone out has to be after the doors open.',
    })
  })

  it('refuses an end date before the start date', () => {
    const endDate = new Date(date.getTime() - DAY)
    expect(runProblems({ ...base, endDate })).toEqual({
      endDate: 'The night cannot end before it starts.',
    })
  })

  it('refuses fifteen nights and allows fourteen', () => {
    const fine = new Date(date.getTime() + MAX_NIGHTS * DAY)
    const tooFar = new Date(date.getTime() + (MAX_NIGHTS + 1) * DAY)
    expect(runProblems({ ...base, endDate: fine })).toEqual({})
    expect(runProblems({ ...base, endDate: tooFar })).toEqual({
      endDate: 'That is more than two weeks from start to finish — check the dates.',
    })
  })

  describe('pack-in and pack-out', () => {
    it('is fine when pack-in is before doors and pack-out is after everyone out', () => {
      expect(
        runProblems({
          date,
          doors: '8:00pm',
          barClose: null,
          allOut: '11:00pm',
          endDate: date,
          packIn: '3:00pm',
          packOut: '1:30am',
        }),
      ).toEqual({})
    })

    it('is fine when pack-in reads the same as doors and pack-out the same as everyone out', () => {
      expect(
        runProblems({
          date,
          doors: '8:00pm',
          barClose: null,
          allOut: '11:00pm',
          endDate: date,
          packIn: '8:00pm',
          packOut: '11:00pm',
        }),
      ).toEqual({})
    })

    it('refuses a pack-in after doors', () => {
      expect(
        runProblems({
          date,
          doors: '8:00pm',
          barClose: null,
          allOut: '11:00pm',
          endDate: date,
          packIn: '9:00pm',
          packOut: null,
        }),
      ).toEqual({ packIn: 'Pack-in has to be at or before the doors open.' })
    })

    it('refuses a pack-out before everyone out, on the same night', () => {
      expect(
        runProblems({
          date,
          doors: '8:00pm',
          barClose: null,
          allOut: '11:30pm',
          endDate: date,
          packIn: null,
          packOut: '11:00pm',
        }),
      ).toEqual({ packOut: 'Pack-out has to be at or after everyone is out.' })
    })

    it('is fine with a pack-out shortly after midnight, following a late everyone-out', () => {
      expect(
        runProblems({
          date,
          doors: '8:00pm',
          barClose: null,
          allOut: '11:30pm',
          endDate: date,
          packIn: null,
          packOut: '1:00am',
        }),
      ).toEqual({})
    })

    it('is not checked while pack-in or pack-out is not decided, or doors is not', () => {
      expect(runProblems({ ...base, packIn: '3:00pm', packOut: '1:30am' })).toEqual({})
      expect(
        runProblems({ date, doors: '8:00pm', barClose: null, allOut: null, endDate: null, packOut: '1:30am' }),
      ).toEqual({})
    })

    it('has no rule about another event — nothing here reads any event but its own', () => {
      // No other event, hold or room is ever passed to runProblems — there is
      // nothing for a rule about one to read. This test exists so the absence
      // stays a decision, not an oversight: Connor, 23 Sep 2026, "We don't
      // need a hard rule that says an event has to be packed out before
      // another has packed in."
      expect(
        runProblems({
          date,
          doors: '8:00pm',
          barClose: null,
          allOut: '11:00pm',
          endDate: date,
          packIn: '3:00pm',
          packOut: '11:00am', // packs out long after this event's own night
        }),
      ).toEqual({})
    })
  })
})
