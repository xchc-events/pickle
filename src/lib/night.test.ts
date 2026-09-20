import { describe, expect, it } from 'vitest'
import {
  VENUE_TZ,
  nightFromInput,
  nightInput,
  nightOf,
  nightOfLocal,
  nightsBetween,
  venueToday,
} from './night'

/**
 * The instant a night is stored as.
 *
 * Every event on the same night has to be the *same* instant. The hold ladder
 * matches a night by exact `date` equality (`src/lib/holds-data.ts`), so two
 * coordinators booking the Main Room for the same Saturday only collide if the
 * seed, the form and every later edit all wrote the identical millisecond. A
 * night that drifted by an hour would double-book the room in silence.
 *
 * UTC midnight is the one instant that reads as the right calendar date
 * through local getters in *both* timezones this app runs in: UTC on CI and on
 * Cloudflare Workers, Pacific/Auckland on the dev machines, where UTC midnight
 * is noon or 1pm the same day. Every screen reads `Event.date` with `getDay()`
 * and `getDate()`, so that is the property these tests are here to hold down.
 */

describe('VENUE_TZ', () => {
  it('is Christchurch — the venue decides what "tonight" means, not the server', () => {
    expect(VENUE_TZ).toBe('Pacific/Auckland')
  })
})

describe('nightOf', () => {
  it('is UTC midnight of the calendar date', () => {
    expect(nightOf(2026, 9, 3).toISOString()).toBe('2026-10-03T00:00:00.000Z')
  })

  it('takes a 0-based month, like Date', () => {
    expect(nightOf(2026, 0, 1).toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(nightOf(2026, 11, 31).toISOString()).toBe('2026-12-31T00:00:00.000Z')
  })

  it('gives the same instant for the same night, every time it is asked', () => {
    // What the hold ladder's equality check depends on.
    expect(nightOf(2026, 9, 3).getTime()).toBe(nightOf(2026, 9, 3).getTime())
  })
})

describe('a night in both timezones the app runs in', () => {
  const calendarDate = (night: Date, timeZone: string): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(night)

  /**
   * The whole reason for storing UTC midnight. CI and Workers run in UTC and
   * the dev machines run in Pacific/Auckland; a night has to be the same
   * calendar date read from either, or the pipeline shows a Friday show on a
   * Thursday to half the people looking at it.
   */
  const zones: [string, Date, string][] = [
    ['in winter, when Christchurch is NZST (UTC+12)', nightOf(2026, 6, 15), '2026-07-15'],
    ['in summer, when Christchurch is NZDT (UTC+13)', nightOf(2026, 0, 15), '2026-01-15'],
  ]

  it.each(zones)('reads as its own calendar date %s', (_, night, expected) => {
    expect(calendarDate(night, 'UTC')).toBe(expected)
    expect(calendarDate(night, VENUE_TZ)).toBe(expected)
  })
})

describe('nightFromInput', () => {
  it('takes what an <input type="date"> sends', () => {
    expect(nightFromInput('2026-10-03')).toEqual(nightOf(2026, 9, 3))
    expect(nightFromInput('2026-10-03')?.toISOString()).toBe('2026-10-03T00:00:00.000Z')
  })

  /**
   * Nothing typed by a person is trusted, and a date that half-parses is worse
   * than none: `new Date('2026-1-3')` is a real instant in some engines and a
   * booking on the wrong night in all of them.
   */
  const bad: [string, string][] = [
    ['2026-02-30', 'a day February does not have'],
    ['2026-02-29', 'the 29th of a February that is not a leap year'],
    ['2026-13-01', 'a month that does not exist'],
    ['03/10/2026', 'the way a person writes it, which is not what the input sends'],
    ['', 'nothing typed at all'],
    ['2026-1-3', 'unpadded parts'],
    [' 2026-10-03', 'a leading space'],
    ['2026-10-03T00:00', 'a time bolted onto the end'],
  ]

  it.each(bad)('reads %j as no night — %s', (value) => {
    expect(nightFromInput(value)).toBeNull()
  })
})

describe('nightInput', () => {
  it('writes a night back the way the input wants it', () => {
    expect(nightInput(nightOf(2026, 9, 3))).toBe('2026-10-03')
  })

  it('pads a single-digit month and day', () => {
    expect(nightInput(nightOf(2026, 0, 5))).toBe('2026-01-05')
  })

  it('round-trips with nightFromInput', () => {
    // The form re-renders what it was given after a failed submit, so this
    // pair has to be lossless or a date changes itself between attempts.
    for (const night of [nightOf(2026, 0, 5), nightOf(2026, 6, 15), nightOf(2026, 9, 3)]) {
      expect(nightFromInput(nightInput(night))).toEqual(night)
    }
    expect(nightInput(nightFromInput('2026-10-03')!)).toBe('2026-10-03')
  })
})

describe('venueToday', () => {
  /**
   * Tonight is Christchurch's night wherever the server is. On Workers in UTC
   * the calendar date is half a day behind the venue for most of the evening,
   * which is exactly when somebody is filling in an enquiry form.
   */
  it('is still yesterday in UTC terms while it is tonight in Christchurch', () => {
    // NZST, UTC+12: 11:30Z is 11:30pm on the 18th at the venue.
    expect(venueToday(new Date('2026-09-18T11:30:00Z'))).toEqual(nightOf(2026, 8, 18))
  })

  it('turns over at midnight in Christchurch, not at midnight UTC', () => {
    // 12:30Z is 12:30am on the 19th at the venue.
    expect(venueToday(new Date('2026-09-18T12:30:00Z'))).toEqual(nightOf(2026, 8, 19))
  })

  it('turns over an hour earlier in daylight saving', () => {
    // NZDT, UTC+13: the day turns over at 11:00Z.
    expect(venueToday(new Date('2026-01-15T10:30:00Z'))).toEqual(nightOf(2026, 0, 15))
    expect(venueToday(new Date('2026-01-15T11:30:00Z'))).toEqual(nightOf(2026, 0, 16))
  })

  it('gives a night, not an instant — UTC midnight like every other night', () => {
    expect(venueToday(new Date('2026-09-18T11:30:00Z')).toISOString()).toBe(
      '2026-09-18T00:00:00.000Z',
    )
  })
})

describe('nightsBetween', () => {
  it('counts the nights forwards', () => {
    expect(nightsBetween(nightOf(2026, 9, 3), nightOf(2026, 9, 10))).toBe(7)
  })

  it('counts backwards as a negative', () => {
    expect(nightsBetween(nightOf(2026, 9, 10), nightOf(2026, 9, 3))).toBe(-7)
  })

  it('is nothing from a night to itself', () => {
    expect(nightsBetween(nightOf(2026, 9, 3), nightOf(2026, 9, 3))).toBe(0)
  })

  /**
   * The date rules count nights back and forward from today, and an
   * off-by-one over a clock change would move the year-ago cutoff by a day.
   * New Zealand goes into daylight saving on Sunday 27 September 2026.
   */
  it('counts whole nights across a New Zealand clock change', () => {
    expect(nightsBetween(nightOf(2026, 8, 26), nightOf(2026, 8, 28))).toBe(2)
    expect(nightsBetween(nightOf(2026, 8, 28), nightOf(2026, 8, 26))).toBe(-2)
  })
})

describe('nightOfLocal', () => {
  /**
   * For `prisma/seed.ts`, which counts days off the machine it runs on. A
   * seeded event and a form-made one on the same night must be the same
   * instant, or they will not collide in the hold ladder.
   */
  it('gives the night of the local calendar date', () => {
    expect(nightOfLocal(new Date(2026, 9, 3, 12))).toEqual(nightOf(2026, 9, 3))
  })

  it('is the same night from either end of the local day', () => {
    expect(nightOfLocal(new Date(2026, 9, 3, 0, 0))).toEqual(nightOf(2026, 9, 3))
    expect(nightOfLocal(new Date(2026, 9, 3, 23, 59))).toEqual(nightOf(2026, 9, 3))
  })
})
