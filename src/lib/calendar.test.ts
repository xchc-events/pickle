import { describe, expect, it } from 'vitest'
import { nightOf } from './night'
import {
  DEFAULT_END,
  DEFAULT_START,
  addDays,
  blockFraction,
  blockLabel,
  dayBlocks,
  eventsOnDay,
  hourLabel,
  mondayOf,
  monthFromInput,
  monthGrid,
  monthLabel,
  monthToInput,
  runWindow,
  weekDays,
} from './calendar'

const night = (y: number, m: number, d: number) => nightOf(y, m, d)

describe('monthGrid', () => {
  it('starts on the Monday on or before the 1st and ends on the Sunday on or after the last day', () => {
    // September 2026: the 1st is a Tuesday, the 30th a Wednesday.
    const grid = monthGrid(2026, 8, night(2026, 8, 23))
    expect(grid[0].date).toEqual(night(2026, 7, 31)) // Monday 31 Aug
    expect(grid.at(-1)!.date).toEqual(night(2026, 9, 4)) // Sunday 4 Oct
    expect(grid.length).toBe(35) // five whole weeks
    expect(grid.length % 7).toBe(0)
  })

  it("marks only the target month's own days as inMonth", () => {
    const grid = monthGrid(2026, 8, night(2026, 8, 23))
    expect(grid[0].inMonth).toBe(false) // 31 Aug, lead-in
    expect(grid.at(-1)!.inMonth).toBe(false) // 4 Oct, lead-out
    expect(grid.filter((d) => d.inMonth)).toHaveLength(30) // September has 30 days
    // The 1st of September is the first in-month cell.
    const firstInMonth = grid.find((d) => d.inMonth)!
    expect(firstInMonth.date).toEqual(night(2026, 8, 1))
  })

  it('marks exactly the cell matching today', () => {
    const today = night(2026, 8, 23)
    const grid = monthGrid(2026, 8, today)
    const marked = grid.filter((d) => d.isToday)
    expect(marked).toHaveLength(1)
    expect(marked[0].date).toEqual(today)
  })

  it('marks no cell as today when today falls outside the grid', () => {
    const grid = monthGrid(2026, 8, night(2027, 0, 1))
    expect(grid.some((d) => d.isToday)).toBe(false)
  })

  it('handles a month starting on Sunday and a short (28-day) February', () => {
    // February 2026: the 1st is a Sunday, the 28th a Saturday.
    const grid = monthGrid(2026, 1, night(2026, 1, 1))
    expect(grid[0].date).toEqual(night(2026, 0, 26)) // Monday 26 Jan
    expect(grid.at(-1)!.date).toEqual(night(2026, 2, 1)) // Sunday 1 Mar
    expect(grid.filter((d) => d.inMonth)).toHaveLength(28)
  })

  it('normalises a monthIndex of 12 into January of the next year', () => {
    const rolled = monthGrid(2026, 12, night(2027, 0, 1))
    const plain = monthGrid(2027, 0, night(2027, 0, 1))
    expect(rolled).toEqual(plain)
  })
})

describe('monthLabel', () => {
  it('names the month and year', () => {
    expect(monthLabel(2026, 8)).toBe('September 2026')
  })

  it('normalises overflow the same way monthGrid does', () => {
    expect(monthLabel(2026, 12)).toBe('January 2027')
    expect(monthLabel(2026, -1)).toBe('December 2025')
  })
})

describe('monthFromInput', () => {
  it('parses a valid YYYY-MM value', () => {
    expect(monthFromInput('2026-09')).toEqual({ year: 2026, monthIndex: 8 })
  })

  it('rejects an out-of-range month, and anything not shaped like YYYY-MM', () => {
    expect(monthFromInput('2026-01')).toEqual({ year: 2026, monthIndex: 0 }) // January is valid
    expect(monthFromInput('2026-13')).toBeNull()
    expect(monthFromInput('2026-00')).toBeNull() // no month 0
    expect(monthFromInput('2026-9')).toBeNull() // not zero-padded
    expect(monthFromInput('not-a-month')).toBeNull()
    expect(monthFromInput(undefined)).toBeNull()
  })
})

describe('monthToInput', () => {
  it('is the inverse of monthFromInput for a normal month', () => {
    expect(monthToInput(2026, 8)).toBe('2026-09')
    expect(monthFromInput(monthToInput(2026, 8))).toEqual({ year: 2026, monthIndex: 8 })
  })

  it('normalises overflow the same way monthGrid and monthLabel do', () => {
    expect(monthToInput(2026, 12)).toBe('2027-01')
    expect(monthToInput(2026, -1)).toBe('2025-12')
  })
})

describe('eventsOnDay', () => {
  const oneNight = { date: night(2026, 8, 10), endDate: null }
  const multiNight = { date: night(2026, 8, 10), endDate: night(2026, 8, 12) }

  it('lists a one-night event only on its own date', () => {
    expect(eventsOnDay([oneNight], night(2026, 8, 10))).toEqual([oneNight])
    expect(eventsOnDay([oneNight], night(2026, 8, 9))).toEqual([])
    expect(eventsOnDay([oneNight], night(2026, 8, 11))).toEqual([])
  })

  it('lists a multi-night event on every date it covers, inclusive', () => {
    expect(eventsOnDay([multiNight], night(2026, 8, 9))).toEqual([])
    expect(eventsOnDay([multiNight], night(2026, 8, 10))).toEqual([multiNight])
    expect(eventsOnDay([multiNight], night(2026, 8, 11))).toEqual([multiNight])
    expect(eventsOnDay([multiNight], night(2026, 8, 12))).toEqual([multiNight])
    expect(eventsOnDay([multiNight], night(2026, 8, 13))).toEqual([])
  })

  it("is generic over whatever extra fields the caller's event carries", () => {
    const withName = { date: night(2026, 8, 1), endDate: null, name: 'Kōura Records' }
    const [found] = eventsOnDay([withName], night(2026, 8, 1))
    expect(found.name).toBe('Kōura Records')
  })
})

describe('weekDays', () => {
  it('returns the seven nights starting from the given Monday', () => {
    const monday = night(2026, 8, 21)
    const days = weekDays(monday, night(2026, 8, 21))
    expect(days).toHaveLength(7)
    expect(days.map((d) => d.date)).toEqual([
      night(2026, 8, 21),
      night(2026, 8, 22),
      night(2026, 8, 23),
      night(2026, 8, 24),
      night(2026, 8, 25),
      night(2026, 8, 26),
      night(2026, 8, 27),
    ])
  })

  it('marks exactly the day matching today', () => {
    const days = weekDays(night(2026, 8, 21), night(2026, 8, 23))
    expect(days.map((d) => d.isToday)).toEqual([false, false, true, false, false, false, false])
  })
})

describe('addDays', () => {
  it('steps forward and backward by whole nights', () => {
    expect(addDays(night(2026, 8, 21), 7)).toEqual(night(2026, 8, 28))
    expect(addDays(night(2026, 8, 21), -7)).toEqual(night(2026, 8, 14))
    expect(addDays(night(2026, 8, 21), 0)).toEqual(night(2026, 8, 21))
  })

  it('crosses a month boundary', () => {
    expect(addDays(night(2026, 8, 28), 7)).toEqual(night(2026, 9, 5))
  })
})

describe('mondayOf', () => {
  it('steps a mid-week night back to its Monday', () => {
    expect(mondayOf(night(2026, 8, 23))).toEqual(night(2026, 8, 21)) // Wed -> Mon
  })

  it('leaves a Monday unchanged', () => {
    expect(mondayOf(night(2026, 8, 21))).toEqual(night(2026, 8, 21))
  })

  it('steps a Sunday back to the Monday six days earlier', () => {
    expect(mondayOf(night(2026, 8, 27))).toEqual(night(2026, 8, 21))
  })
})

describe('hourLabel', () => {
  it('reads midnight and noon as 12am / 12pm, and drops leading zeroes', () => {
    expect(hourLabel(0)).toBe('12am')
    expect(hourLabel(1)).toBe('1am')
    expect(hourLabel(12)).toBe('12pm')
    expect(hourLabel(13)).toBe('1pm')
    expect(hourLabel(23)).toBe('11pm')
  })
})

describe('blockFraction', () => {
  it('places a same-day run as a plain top/height fraction', () => {
    // 8:00pm (1200) to 11:00pm (1380)
    const g = blockFraction('8:00pm', '11:00pm')
    expect(g.clipped).toBe(false)
    expect(g.top).toBeCloseTo(1200 / 1440)
    expect(g.height).toBeCloseTo(180 / 1440)
  })

  it('clips a run past midnight at the end of the day', () => {
    // 11:00pm (1380) to 1:00am (60) — the small-hours case from the brief.
    const g = blockFraction('11:00pm', '1:00am')
    expect(g.clipped).toBe(true)
    expect(g.top).toBeCloseTo(1380 / 1440)
    expect(g.height).toBeCloseTo(60 / 1440) // runs to midnight, not past it
  })

  it('treats an end reading equal to the start as crossing midnight too', () => {
    const g = blockFraction('9:00pm', '9:00pm')
    expect(g.clipped).toBe(true)
  })
})

describe('blockLabel', () => {
  it('shows the default-window placeholder before anything else', () => {
    expect(blockLabel('7:00pm', '11:00pm', false, true)).toBe('Times not set')
  })

  it('shows an en-dash range for a same-day block', () => {
    expect(blockLabel('8:00pm', '11:00pm', false, false)).toBe('8:00pm – 11:00pm')
  })

  it('shows an arrow to the end time for a clipped block', () => {
    expect(blockLabel('11:00pm', '1:00am', true, false)).toBe('→ 1:00am')
  })
})

describe('runWindow', () => {
  it('prefers pack-in/pack-out when both are set, even alongside doors/allOut', () => {
    const w = runWindow({ packIn: '6:00pm', packOut: '2:00am', doors: '8:00pm', allOut: '1:00am' })
    expect(w).toEqual({ start: '6:00pm', end: '2:00am', defaulted: false })
  })

  it('falls back to doors/allOut when only one pack time is set', () => {
    const w = runWindow({ packIn: '6:00pm', packOut: null, doors: '8:00pm', allOut: '1:00am' })
    expect(w).toEqual({ start: '8:00pm', end: '1:00am', defaulted: false })
  })

  it('falls back to the default window when only one of doors/allOut is set', () => {
    const w = runWindow({ packIn: null, packOut: null, doors: '8:00pm', allOut: null })
    expect(w).toEqual({ start: DEFAULT_START, end: DEFAULT_END, defaulted: true })
  })

  it('falls back to the default window when nothing at all is set', () => {
    const w = runWindow({ packIn: null, packOut: null, doors: null, allOut: null })
    expect(w.defaulted).toBe(true)
  })
})

describe('dayBlocks', () => {
  const base = { date: night(2026, 8, 10), packIn: null, packOut: null }

  it('gives a single event the whole lane', () => {
    const blocks = dayBlocks([{ ...base, doors: '8:00pm', allOut: '11:00pm' }], night(2026, 8, 10))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].lane).toBe(0)
    expect(blocks[0].lanes).toBe(1)
  })

  it('excludes events on a different night', () => {
    const blocks = dayBlocks([{ ...base, doors: '8:00pm', allOut: '11:00pm' }], night(2026, 8, 11))
    expect(blocks).toEqual([])
  })

  it('never refuses an overlap: two overlapping events sit side by side', () => {
    const a = { ...base, doors: '8:00pm', allOut: '11:00pm' } // 1200-1380
    const b = { ...base, doors: '9:00pm', allOut: '10:00pm' } // 1260-1320, inside a
    const blocks = dayBlocks([a, b], night(2026, 8, 10))
    expect(blocks).toHaveLength(2)
    expect(new Set(blocks.map((b) => b.lane))).toEqual(new Set([0, 1]))
    expect(blocks.every((b) => b.lanes === 2)).toBe(true)
  })

  it('gives non-overlapping events on the same night their own full-width lane', () => {
    const a = { ...base, doors: '6:00pm', allOut: '8:00pm' }
    const b = { ...base, doors: '9:00pm', allOut: '11:00pm' }
    const blocks = dayBlocks([a, b], night(2026, 8, 10))
    expect(blocks.every((b) => b.lane === 0 && b.lanes === 1)).toBe(true)
  })

  it('reuses a lane once its event has ended, across a chain of overlaps', () => {
    const a = { ...base, doors: '6:00pm', allOut: '8:00pm' } // 0.0-ish block 1
    const b = { ...base, doors: '7:00pm', allOut: '9:00pm' } // overlaps a
    const c = { ...base, doors: '8:30pm', allOut: '10:00pm' } // overlaps b, not a
    const blocks = dayBlocks([a, b, c], night(2026, 8, 10))
    const byStart = [...blocks].sort((x, y) => x.top - y.top)
    expect(byStart.map((b) => b.lane)).toEqual([0, 1, 0])
    expect(blocks.every((b) => b.lanes === 2)).toBe(true)
  })

  it('flags a block placed by the default window', () => {
    const blocks = dayBlocks([{ ...base, doors: null, allOut: null }], night(2026, 8, 10))
    expect(blocks[0].defaulted).toBe(true)
    expect(blocks[0].label).toBe('Times not set')
  })

  it('flags and labels a block clipped at midnight', () => {
    const blocks = dayBlocks([{ ...base, doors: '11:00pm', allOut: '1:00am' }], night(2026, 8, 10))
    expect(blocks[0].clipped).toBe(true)
    expect(blocks[0].label).toBe('→ 1:00am')
  })
})
