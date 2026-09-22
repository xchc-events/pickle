import { describe, expect, it, vi } from 'vitest'

/**
 * `crewCallStart` — where a set-up or clean-up shift's call defaults to once
 * pack-in and pack-out are set.
 *
 * `loadRoster` itself reads the database directly and is exercised through
 * the app, not unit-tested here; this file is for the pure rule E1 adds
 * alongside it, the same split `run-times.ts`/`run-times.test.ts` already
 * keep between a rule and the action built on it.
 */

// roster-data.ts is a server module — 'server-only' throws outside a
// server-component build, and `db` is a live driver adapter neither of which
// this file needs to touch a real database to exercise a pure function.
vi.mock('server-only', () => ({}))
vi.mock('./db', () => ({ db: {} }))

const { crewCallStart, fiveTimesLine } = await import('./roster-data')

describe('crewCallStart', () => {
  const FALLBACK = 3 // stands in for whatever src/lib/roster.ts's own table says

  it('falls back for a role that is neither set-up nor clean-up crew', () => {
    expect(crewCallStart('Duty manager', 6, FALLBACK, '8:00pm', '3:00pm', '1:30am')).toBe(FALLBACK)
  })

  it('falls back when doors is not decided yet — there is nothing to offset from', () => {
    expect(crewCallStart('Set-up crew', 0.75, FALLBACK, null, '3:00pm', null)).toBe(FALLBACK)
  })

  describe('set-up crew', () => {
    it('starts at pack-in, as hours before doors', () => {
      // Doors 8pm, pack-in 3pm: five hours before doors.
      expect(crewCallStart('Set-up crew', 0.75, FALLBACK, '8:00pm', '3:00pm', null)).toBe(-5)
    })

    it('falls back to the generic window when pack-in is not set', () => {
      expect(crewCallStart('Set-up crew', 0.75, FALLBACK, '8:00pm', null, '1:30am')).toBe(FALLBACK)
    })

    it('is unaffected by pack-out', () => {
      expect(crewCallStart('Set-up crew', 0.75, FALLBACK, '8:00pm', '3:00pm', '1:30am')).toBe(-5)
    })
  })

  describe('clean-up crew', () => {
    it('ends at pack-out, its start worked back from pack-out by its own length', () => {
      // Doors 8pm, pack-out 1:30am (5.5h after doors), 0.75h shift: starts
      // 4.75h after doors so it finishes exactly at pack-out.
      expect(crewCallStart('Clean-up crew', 0.75, FALLBACK, '8:00pm', null, '1:30am')).toBeCloseTo(
        4.75,
      )
    })

    it('reads a pack-out that has not rolled past midnight the same way', () => {
      // Doors 2pm, pack-out 6pm (4h after doors), 0.75h shift: starts 3.25h
      // after doors.
      expect(crewCallStart('Clean-up crew', 0.75, FALLBACK, '2:00pm', null, '6:00pm')).toBeCloseTo(
        3.25,
      )
    })

    it('falls back to the generic window when pack-out is not set', () => {
      expect(crewCallStart('Clean-up crew', 0.75, FALLBACK, '8:00pm', '3:00pm', null)).toBe(FALLBACK)
    })

    it('is unaffected by pack-in', () => {
      expect(crewCallStart('Clean-up crew', 0.75, FALLBACK, '8:00pm', '3:00pm', '1:30am')).toBeCloseTo(
        4.75,
      )
    })
  })
})

describe('fiveTimesLine', () => {
  it('labels and orders all five when every one is set', () => {
    expect(
      fiveTimesLine({
        packIn: '3:00pm',
        doors: '8:00pm',
        barClose: '11:30pm',
        allOut: '1:00am',
        packOut: '1:30am',
      }),
    ).toBe('Pack-in 3:00pm · Doors 8:00pm · Bar close 11:30pm · Everyone out 1:00am · Pack-out 1:30am')
  })

  it('leaves out whichever are not decided yet, keeping the rest in order', () => {
    expect(
      fiveTimesLine({ packIn: null, doors: '8:00pm', barClose: null, allOut: '1:00am', packOut: null }),
    ).toBe('Doors 8:00pm · Everyone out 1:00am')
  })

  it('is empty when nothing is decided', () => {
    expect(
      fiveTimesLine({ packIn: null, doors: null, barClose: null, allOut: null, packOut: null }),
    ).toBe('')
  })
})
