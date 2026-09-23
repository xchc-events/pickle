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

const { crewCallStart, fiveTimesLine, clockInputFor, offsetFromClock, callTimes, salesStripFor } =
  await import('./roster-data')

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
      expect(crewCallStart('Clean-up crew', 0.75, FALLBACK, '8:00pm', '3:00pm', null)).toBe(
        FALLBACK,
      )
    })

    it('is unaffected by pack-in', () => {
      expect(
        crewCallStart('Clean-up crew', 0.75, FALLBACK, '8:00pm', '3:00pm', '1:30am'),
      ).toBeCloseTo(4.75)
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
    ).toBe(
      'Pack-in 3:00pm · Doors 8:00pm · Bar close 11:30pm · Everyone out 1:00am · Pack-out 1:30am',
    )
  })

  it('leaves out whichever are not decided yet, keeping the rest in order', () => {
    expect(
      fiveTimesLine({
        packIn: null,
        doors: '8:00pm',
        barClose: null,
        allOut: '1:00am',
        packOut: null,
      }),
    ).toBe('Doors 8:00pm · Everyone out 1:00am')
  })

  it('is empty when nothing is decided', () => {
    expect(
      fiveTimesLine({ packIn: null, doors: null, barClose: null, allOut: null, packOut: null }),
    ).toBe('')
  })
})

/**
 * `clockInputFor` / `offsetFromClock` — R1 adds, so a shift's editor can
 * show and save actual clock times on the night rather than a bare offset.
 * They are each other's inverse: what one derives, the other reads back.
 */
describe('clockInputFor', () => {
  it('is blank when doors is not decided yet', () => {
    expect(clockInputFor(null, 3)).toBe('')
  })

  it('reads a positive offset forward from doors', () => {
    // Doors 8pm, three hours on: 11pm.
    expect(clockInputFor('8:00pm', 3)).toBe('23:00')
  })

  it('reads a negative offset backward from doors, same night', () => {
    // Doors 8pm, five hours before: 3pm.
    expect(clockInputFor('8:00pm', -5)).toBe('15:00')
  })

  it('carries an offset that runs past midnight to the small hours', () => {
    // Doors 8pm, 4.75h on: 12:45am.
    expect(clockInputFor('8:00pm', 4.75)).toBe('00:45')
  })
})

describe('offsetFromClock', () => {
  it('is null when doors is not decided yet', () => {
    expect(offsetFromClock('11:00pm', null, 3)).toBeNull()
  })

  it('is null when the clock reading is not a real time', () => {
    expect(offsetFromClock('not a time', '8:00pm', 3)).toBeNull()
  })

  it('reads a same-night reading after doors as a positive offset', () => {
    expect(offsetFromClock('11:00pm', '8:00pm', 3)).toBe(3)
  })

  it('reads a same-night reading before doors as a negative offset, anchored on the existing one', () => {
    // 3pm is five hours before an 8pm doors time — the set-up crew case.
    expect(offsetFromClock('3:00pm', '8:00pm', -5)).toBe(-5)
  })

  it('carries a small-hours reading past midnight when the anchor says so', () => {
    expect(offsetFromClock('12:45am', '8:00pm', 4.75)).toBeCloseTo(4.75)
  })

  it('round-trips exactly with clockInputFor for a range of offsets', () => {
    for (const offset of [-5, -0.75, 0, 3.75, 4.75, 9, 11.5]) {
      const input = clockInputFor('8:00pm', offset)
      // clockInputFor returns an <input type="time"> value ("HH:MM"); reading
      // it back as a clock label needs its minute reading, not the parse
      // itself — same round trip the editor performs through clockFromInput.
      const [hh, mm] = input.split(':')
      const h24 = Number(hh)
      const period = h24 < 12 ? 'am' : 'pm'
      const h12 = h24 % 12 || 12
      const label = `${h12}:${mm}${period}`
      expect(offsetFromClock(label, '8:00pm', offset)).toBeCloseTo(offset)
    }
  })

  it('picks the reading nearest the anchor rather than the literal next occurrence', () => {
    // Anchor -5 (set-up, before doors): 3pm reads as -5, not +19.
    expect(offsetFromClock('3:00pm', '8:00pm', -5)).toBe(-5)
    // The same clock reading, anchored the other side, reads as +19.
    expect(offsetFromClock('3:00pm', '8:00pm', 19)).toBe(19)
  })
})

describe('callTimes', () => {
  it('reads as clock times once doors is decided', () => {
    // Doors 8pm, start 3.5h on (11:30pm), runs 6h — to 5:30am.
    expect(callTimes('8:00pm', 3.5, 6)).toBe('11:30pm–5:30am')
  })

  it('is null while doors is not decided yet', () => {
    expect(callTimes(null, 3.5, 6)).toBeNull()
  })
})

describe('salesStripFor', () => {
  const space = { capacity: 220, seatedCapacity: 150 }
  const base = {
    sold: 0,
    updatedAt: new Date(2026, 8, 1),
    att: [80, 120, 180] as number[],
    format: 'DJs',
    kind: 'djs',
    barClose: '1:00am',
    space,
  }

  it('reads sold from readSales, not the row directly', () => {
    expect(salesStripFor({ ...base, sold: 57 }).sold).toBe(57)
  })

  it('reads the likely turnout from att[1]', () => {
    expect(salesStripFor({ ...base, att: [40, 96, 150] }).likely).toBe(96)
  })

  it('is zero for the likely turnout when att has not been modelled', () => {
    expect(salesStripFor({ ...base, att: [] }).likely).toBe(0)
  })

  it('reads capacity from capacityOf, respecting a Cabaret layout', () => {
    expect(salesStripFor({ ...base, format: 'DJs' }).capacity).toBe(220)
    expect(salesStripFor({ ...base, format: 'Cabaret' }).capacity).toBe(150)
  })

  it("counts the standard plan's shifts at this turnout", () => {
    const workshop = salesStripFor({ ...base, kind: 'workshop' })
    const music = salesStripFor({ ...base, kind: 'djs' })
    // A workshop runs one door and one care team where a show runs two of
    // each — fewer shifts in the standard plan.
    expect(workshop.planned).toBeLessThan(music.planned)
  })
})
