import { describe, expect, it } from 'vitest'
import {
  buildRosterTimeline,
  clampEdges,
  clockLabelForOffset,
  fractionForOffset,
  hoursToClockInput,
  offsetForFraction,
  snapQuarterHour,
  type TimelineEventInput,
  type TimelineShiftInput,
} from './roster-timeline'

describe('snapQuarterHour', () => {
  it('leaves an exact quarter-hour unchanged', () => {
    expect(snapQuarterHour(3.25)).toBeCloseTo(3.25, 5)
    expect(snapQuarterHour(0)).toBeCloseTo(0, 5)
  })

  it('rounds down to the nearer quarter-hour', () => {
    expect(snapQuarterHour(3.1)).toBeCloseTo(3, 5)
  })

  it('rounds up to the nearer quarter-hour', () => {
    expect(snapQuarterHour(3.2)).toBeCloseTo(3.25, 5)
  })

  it('snaps a negative offset the same way', () => {
    expect(snapQuarterHour(-1.3)).toBeCloseTo(-1.25, 5)
  })
})

describe('clampEdges', () => {
  it('passes a normally ordered pair through unchanged', () => {
    expect(clampEdges(1, 3)).toEqual({ start: 1, end: 3 })
  })

  it('passes a pair exactly at the minimum span through unchanged', () => {
    expect(clampEdges(1, 1.25)).toEqual({ start: 1, end: 1.25 })
  })

  it('pushes the end out when a pair collapses below the minimum span', () => {
    expect(clampEdges(1, 1.1)).toEqual({ start: 1, end: 1.25 })
  })

  it('pulls the start back when the end is dragged before it', () => {
    expect(clampEdges(3, 1)).toEqual({ start: 0.75, end: 1 })
  })
})

describe('fractionForOffset / offsetForFraction', () => {
  it('maps the axis bounds to 0 and 1', () => {
    expect(fractionForOffset(0, 0, 10)).toBeCloseTo(0, 5)
    expect(fractionForOffset(10, 0, 10)).toBeCloseTo(1, 5)
    expect(fractionForOffset(5, 0, 10)).toBeCloseTo(0.5, 5)
  })

  it('round-trips a fraction back to the same offset', () => {
    const fraction = fractionForOffset(3.7, -2, 9.5)
    expect(offsetForFraction(fraction, -2, 9.5)).toBeCloseTo(3.7, 5)
  })

  it('never divides by zero on a collapsed axis', () => {
    expect(fractionForOffset(5, 5, 5)).toBe(0)
  })
})

describe('hoursToClockInput', () => {
  it('adds the offset onto doors', () => {
    expect(hoursToClockInput('8:00pm', 3.5)).toBe('23:30')
  })

  it('carries an offset past midnight', () => {
    expect(hoursToClockInput('8:00pm', 7)).toBe('03:00')
  })

  it('carries a negative offset back before midnight', () => {
    expect(hoursToClockInput('8:00pm', -1)).toBe('19:00')
  })

  it('is empty when doors is not decided yet', () => {
    expect(hoursToClockInput(null, 3.5)).toBe('')
  })
})

describe('clockLabelForOffset', () => {
  it('reads as a 12-hour clock label', () => {
    expect(clockLabelForOffset('8:00pm', 3.5)).toBe('11:30pm')
    expect(clockLabelForOffset('8:00pm', 7)).toBe('3:00am')
  })

  it('is empty when doors is not decided yet', () => {
    expect(clockLabelForOffset(null, 3.5)).toBe('')
  })
})

describe('buildRosterTimeline', () => {
  const fullEvent: TimelineEventInput = {
    packIn: '7:00pm',
    doors: '8:00pm',
    barClose: '1:00am',
    allOut: '4:00am',
    packOut: '4:30am',
  }

  const shifts: TimelineShiftInput[] = [
    { id: 'covered', role: 'Bar staff', start: 3.5, hours: 5, state: 'ASSIGNED', personInitials: 'JD' },
    { id: 'open', role: 'Door', start: 0, hours: 6, state: 'OPEN', personInitials: null },
    { id: 'offered', role: 'Sound — Lead', start: -1, hours: 2, state: 'OFFERED', personInitials: 'AB' },
  ]

  it('sets the axis an hour before pack-in and an hour after pack-out', () => {
    const t = buildRosterTimeline(fullEvent, [])
    // pack-in 7pm is 1h before 8pm doors (offset -1) -> axis starts at -2.
    expect(t.axisStart).toBeCloseTo(-2, 5)
    // pack-out 4:30am carries to offset 8.5 past doors -> axis ends at 9.5.
    expect(t.axisEnd).toBeCloseTo(9.5, 5)
  })

  it('places all five marks, labelled with the raw clock reading, carried past midnight', () => {
    const t = buildRosterTimeline(fullEvent, [])
    expect(t.marks.map((m) => m.key)).toEqual(['packIn', 'doors', 'barClose', 'allOut', 'packOut'])
    expect(t.marks.map((m) => m.label)).toEqual([
      'Pack-in 7:00pm',
      'Doors 8:00pm',
      'Bar close 1:00am',
      'Everyone out 4:00am',
      'Pack-out 4:30am',
    ])
    // Doors sits exactly at offset 0 -> (0 - -2) / 11.5.
    expect(t.marks.find((m) => m.key === 'doors')!.fraction).toBeCloseTo(2 / 11.5, 5)
    // Bar close at 1am carries to offset 5 -> after doors, not before.
    expect(t.marks.find((m) => m.key === 'barClose')!.fraction).toBeCloseTo(7 / 11.5, 5)
  })

  it('lays out one bar a shift, as fractions of the same axis', () => {
    const t = buildRosterTimeline(fullEvent, shifts)
    const span = t.axisEnd - t.axisStart // 11.5

    const covered = t.bars.find((b) => b.id === 'covered')!
    expect(covered.tone).toBe('covered')
    expect(covered.label).toBe('JD')
    expect(covered.startFraction).toBeCloseTo((3.5 - t.axisStart) / span, 5)
    expect(covered.endFraction).toBeCloseTo((8.5 - t.axisStart) / span, 5)

    const open = t.bars.find((b) => b.id === 'open')!
    expect(open.tone).toBe('open')
    expect(open.label).toBe('') // nobody on it yet

    const offered = t.bars.find((b) => b.id === 'offered')!
    expect(offered.tone).toBe('offered')
    expect(offered.label).toBe('AB')
  })

  it('treats an ASKED shift as open, the same as page.tsx does', () => {
    const t = buildRosterTimeline(fullEvent, [
      { id: 's', role: 'Door', start: 0, hours: 1, state: 'ASKED', personInitials: null },
    ])
    expect(t.bars[0].tone).toBe('open')
  })

  it('renders an empty roster: no bars, axis and marks unaffected', () => {
    const withShifts = buildRosterTimeline(fullEvent, shifts)
    const empty = buildRosterTimeline(fullEvent, [])
    expect(empty.bars).toEqual([])
    expect(empty.axisStart).toBe(withShifts.axisStart)
    expect(empty.axisEnd).toBe(withShifts.axisEnd)
    expect(empty.marks).toEqual(withShifts.marks)
  })

  it('generates hour ticks across the axis, labelled from doors', () => {
    const t = buildRosterTimeline(fullEvent, [])
    expect(t.ticks).toHaveLength(12) // -2..9 inclusive
    expect(t.ticks.find((tk) => tk.hours === 0)!.label).toBe('8:00pm')
    expect(t.ticks.find((tk) => tk.hours === 9)!.label).toBe('5:00am')
  })

  it('falls back to the shifts’ own extent when doors is not decided yet', () => {
    const noDoors: TimelineEventInput = {
      packIn: null,
      doors: null,
      barClose: null,
      allOut: null,
      packOut: null,
    }
    const t = buildRosterTimeline(noDoors, [
      { id: 'a', role: 'Door', start: -1, hours: 2, state: 'OPEN', personInitials: null },
      { id: 'b', role: 'Bar staff', start: 3.5, hours: 5, state: 'ASSIGNED', personInitials: 'JD' },
    ])
    expect(t.axisStart).toBeCloseTo(-2, 5) // min(0, -1, 3.5) - 1
    expect(t.axisEnd).toBeCloseTo(9.5, 5) // max(0, 1, 8.5) + 1
    expect(t.marks).toEqual([]) // nothing to anchor a clock mark to
  })

  it('falls back to a plain default axis with no doors and no shifts', () => {
    const noDoors: TimelineEventInput = {
      packIn: null,
      doors: null,
      barClose: null,
      allOut: null,
      packOut: null,
    }
    const t = buildRosterTimeline(noDoors, [])
    expect(t.axisStart).toBe(-1)
    expect(t.axisEnd).toBe(8)
    expect(t.marks).toEqual([])
    expect(t.bars).toEqual([])
  })

  it('shows only the marks whose own clock reading is decided', () => {
    const doorsOnly: TimelineEventInput = {
      packIn: null,
      doors: '8:00pm',
      barClose: null,
      allOut: '3:00am',
      packOut: null,
    }
    const t = buildRosterTimeline(doorsOnly, [])
    // pack-in falls back to doors (offset 0) for the axis start, and
    // pack-out falls back to everyone-out for the axis end.
    expect(t.axisStart).toBeCloseTo(-1, 5)
    expect(t.axisEnd).toBeCloseTo(8, 5) // 3am carries to offset 7 past 8pm doors -> +1
    expect(t.marks.map((m) => m.key)).toEqual(['doors', 'allOut'])
  })

  it('falls back to the shifts’ own extent when doors is known but neither pack-out nor everyone-out is', () => {
    const doorsOnly: TimelineEventInput = {
      packIn: null,
      doors: '8:00pm',
      barClose: null,
      allOut: null,
      packOut: null,
    }
    const t = buildRosterTimeline(doorsOnly, [
      { id: 'a', role: 'Door', start: 0, hours: 2, state: 'OPEN', personInitials: null },
      { id: 'b', role: 'Bar staff', start: 5, hours: 1, state: 'OPEN', personInitials: null },
    ])
    expect(t.axisStart).toBeCloseTo(-1, 5)
    expect(t.axisEnd).toBeCloseTo(7, 5) // max shift end (6) + 1
  })
})
