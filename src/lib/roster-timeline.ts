import { clockFromInput, minutesOfDay } from './run-times'

/**
 * The roster's night-as-a-timeline: pure geometry only, no DOM and no
 * server action. `RosterTimeline.tsx` draws from what this computes; the
 * drag itself re-runs `snapQuarterHour` / `clampEdges` / `hoursToClockInput`
 * live against a pointer position, then hands the result to the same
 * `retimeShift` the shift editor already calls.
 *
 * Connor, 23 Sep 2026: "To see in a more visual way what period of time each
 * person is going to be on site... something very similar to the Google
 * Calendar day or week view." · "It should pull through the pack-in time and
 * pack-out time to the roster, so you can really clearly see that."
 *
 * Everything here works in one unit: **hours offset from doors**, the same
 * unit `Shift.start` and `Shift.hours` are already stored in, so a shift's
 * bar needs no conversion at all to lay out. Doors itself is offset 0.
 * Converting the event's five clock-of-night marks into that same unit
 * mirrors `crewCallStart` and `runProblems` in `roster-data.ts` /
 * `run-times.ts` exactly: pack-in never carries past midnight (it is always
 * on the start night, before doors), the other three take the first
 * occurrence of that clock reading at or after doors. Kept as a parallel
 * implementation, not an import, because `roster-data.ts` opens with
 * `import 'server-only'` and this module has to run on the client mid-drag.
 */

const MIN_SPAN_HOURS = 0.25 // 15 minutes — the same floor retimeShift enforces server-side.

export type ShiftTimelineTone = 'open' | 'offered' | 'covered'

/** One shift's plain geometry input — exactly what the timeline needs,
 *  independent of how the page loaded it. */
export interface TimelineShiftInput {
  id: string
  role: string
  /** Hours offset from doors — the same unit as `Shift.start`. */
  start: number
  hours: number
  state: string
  personInitials: string | null
}

export interface TimelineEventInput {
  doors: string | null
  packIn: string | null
  barClose: string | null
  allOut: string | null
  packOut: string | null
}

export interface TimelineMark {
  key: 'packIn' | 'doors' | 'barClose' | 'allOut' | 'packOut'
  label: string
  /** Fraction across the axis, 0 (axisStart) – 1 (axisEnd). */
  fraction: number
}

export interface TimelineMarkRow extends TimelineMark {
  /** 0 = the marks' own row, above the bars; 1 = staggered one row further
   *  down because it sat too close to the previous mark to read. */
  row: number
}

/** Below this, in pixels, two mark labels are assumed to overlap. Connor's
 *  own report: "Bar close 11:00pm" and "Everyone out 11:30pm" (24 Sep 2026). */
const MARK_COLLISION_PX = 70

export interface TimelineTick {
  hours: number
  label: string
  fraction: number
}

export interface TimelineBar {
  id: string
  role: string
  /** Initials, or '' for an open shift with nobody on it yet. */
  label: string
  tone: ShiftTimelineTone
  startHours: number
  endHours: number
  startFraction: number
  endFraction: number
}

export interface RosterTimeline {
  axisStart: number
  axisEnd: number
  marks: TimelineMark[]
  ticks: TimelineTick[]
  bars: TimelineBar[]
}

/** Snap to the nearest 15 minutes. Multiplying by 4 first keeps the result
 *  an exact quarter-hour instead of accumulating float noise. */
export function snapQuarterHour(hours: number): number {
  return Math.round(hours * 4) / 4
}

/** Keep a dragged edge from inverting or collapsing to nothing, the same
 *  floor `retimeShift` enforces server-side ("the end cannot be before the
 *  start") — applied live so a bar never shows a drag the server would
 *  refuse. */
export function clampEdges(start: number, end: number): { start: number; end: number } {
  if (end - start >= MIN_SPAN_HOURS) return { start, end }
  return start <= end
    ? { start, end: start + MIN_SPAN_HOURS }
    : { start: end - MIN_SPAN_HOURS, end }
}

export function fractionForOffset(offsetHours: number, axisStart: number, axisEnd: number): number {
  const span = axisEnd - axisStart
  return span > 0 ? (offsetHours - axisStart) / span : 0
}

export function offsetForFraction(fraction: number, axisStart: number, axisEnd: number): number {
  return axisStart + fraction * (axisEnd - axisStart)
}

/**
 * Hours-from-doors back to an `<input type="time">` value, for
 * `retimeShift`'s `{ start, end }`. Mirrors `clockInputFor` in
 * `roster-data.ts` exactly — see the module docs for why it is not imported
 * from there.
 */
export function hoursToClockInput(doors: string | null, offsetHours: number): string {
  const doorsM = minutesOfDay(doors)
  if (doorsM === null) return ''

  const totalMin = Math.round(doorsM + offsetHours * 60)
  const wrapped = ((totalMin % 1440) + 1440) % 1440
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0')
  const mm = String(wrapped % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/** e.g. offset 7.5h past an 8:00pm doors -> "3:30am". '' when doors is not
 *  decided yet, the same case `hoursToClockInput` falls back on — for the
 *  live label a dragged bar shows while it moves. */
export function clockLabelForOffset(doors: string | null, offsetHours: number): string {
  const input = hoursToClockInput(doors, offsetHours)
  return input ? (clockFromInput(input) ?? '') : ''
}

/** Pack-in is always on the start night, before doors — no carry. */
function offsetNoCarry(clock: string | null, doorsMinutes: number): number | null {
  const m = minutesOfDay(clock)
  return m === null ? null : (m - doorsMinutes) / 60
}

/** Bar close, everyone-out and pack-out read as the first time that clock
 *  reading comes round again at or after doors open — the small-hours carry
 *  `runProblems` and `crewCallStart` both use. */
function offsetWithCarry(clock: string | null, doorsMinutes: number): number | null {
  const m = minutesOfDay(clock)
  if (m === null) return null
  const fromDoors = m > doorsMinutes ? m - doorsMinutes : m + 1440 - doorsMinutes
  return fromDoors / 60
}

const MARK_DEFS: {
  key: TimelineMark['key']
  label: string
  pick: (e: TimelineEventInput) => string | null
  carry: boolean
}[] = [
  { key: 'packIn', label: 'Pack-in', pick: (e) => e.packIn, carry: false },
  { key: 'doors', label: 'Doors', pick: (e) => e.doors, carry: false },
  { key: 'barClose', label: 'Bar close', pick: (e) => e.barClose, carry: true },
  { key: 'allOut', label: 'Everyone out', pick: (e) => e.allOut, carry: true },
  { key: 'packOut', label: 'Pack-out', pick: (e) => e.packOut, carry: true },
]

/**
 * The axis, the five run-time marks and one bar a shift, all as plain
 * numbers and 0–1 fractions ready to draw. Bounds are "an hour before
 * pack-in (or doors) to an hour after pack-out (or everyone out)" (Connor),
 * but a shift is allowed to run outside the marks — the night is not a hard
 * rule (see roster-data.ts) — so the axis widens to the earliest shift start
 * and the latest shift end plus 30 minutes whenever either falls outside
 * that mark-based range. No bar is ever clipped.
 *
 * Sunday Slow Roast, seeded (Connor, 24 Sep 2026): with the marks-only
 * bound, a clean-up crew shift running past everyone-out had no bar at all,
 * and several others were clipped at the right edge.
 *
 * When doors itself is not decided yet, none of the five clock marks can be
 * placed relative to it, so the axis falls back to the shifts' own extent,
 * and then to a plain default so an empty, undecided roster still renders
 * an axis rather than nothing.
 */
export function buildRosterTimeline(
  event: TimelineEventInput,
  shifts: TimelineShiftInput[],
): RosterTimeline {
  const doorsM = minutesOfDay(event.doors)

  let axisStart: number
  let axisEnd: number

  if (doorsM !== null) {
    const packInOffset = offsetNoCarry(event.packIn, doorsM) ?? 0 // 0 = doors itself
    const markStart = packInOffset - 1
    const earliestShiftStart = shifts.length > 0 ? Math.min(...shifts.map((s) => s.start)) : null
    axisStart = earliestShiftStart !== null ? Math.min(markStart, earliestShiftStart) : markStart

    const rightAnchor =
      offsetWithCarry(event.packOut, doorsM) ?? offsetWithCarry(event.allOut, doorsM)
    const markEnd = rightAnchor !== null ? rightAnchor + 1 : null
    const latestShiftEnd =
      shifts.length > 0 ? Math.max(...shifts.map((s) => s.start + s.hours)) + 0.5 : null
    axisEnd =
      markEnd !== null && latestShiftEnd !== null
        ? Math.max(markEnd, latestShiftEnd)
        : (markEnd ?? latestShiftEnd ?? axisStart + 9)
  } else if (shifts.length > 0) {
    axisStart = Math.min(0, ...shifts.map((s) => s.start)) - 1
    axisEnd = Math.max(0, ...shifts.map((s) => s.start + s.hours)) + 1
  } else {
    axisStart = -1
    axisEnd = 8
  }

  if (axisEnd <= axisStart) axisEnd = axisStart + 1 // defensive: never a zero/negative span

  const marks: TimelineMark[] =
    doorsM === null
      ? []
      : MARK_DEFS.flatMap(({ key, label, pick, carry }) => {
          const clock = pick(event)
          if (!clock) return []
          const offset = carry ? offsetWithCarry(clock, doorsM) : offsetNoCarry(clock, doorsM)
          if (offset === null) return []
          return [
            {
              key,
              label: `${label} ${clock}`,
              fraction: fractionForOffset(offset, axisStart, axisEnd),
            },
          ]
        })

  const ticks: TimelineTick[] = []
  for (let h = Math.ceil(axisStart); h <= Math.floor(axisEnd); h++) {
    const clockLabel = clockLabelForOffset(event.doors, h)
    ticks.push({
      hours: h,
      label: clockLabel || (h === 0 ? 'Doors' : `Doors ${h > 0 ? '+' : ''}${h}h`),
      fraction: fractionForOffset(h, axisStart, axisEnd),
    })
  }

  const bars: TimelineBar[] = shifts.map((s) => {
    const end = s.start + s.hours
    const tone: ShiftTimelineTone =
      s.state === 'OPEN' || s.state === 'ASKED'
        ? 'open'
        : s.state === 'OFFERED'
          ? 'offered'
          : 'covered'

    return {
      id: s.id,
      role: s.role,
      label: s.personInitials ?? '',
      tone,
      startHours: s.start,
      endHours: end,
      startFraction: fractionForOffset(s.start, axisStart, axisEnd),
      endFraction: fractionForOffset(end, axisStart, axisEnd),
    }
  })

  return { axisStart, axisEnd, marks, ticks, bars }
}

/**
 * Which row each of the five run-time marks' labels draws on: row 0 sits
 * above the bars, same as before; a mark within `MARK_COLLISION_PX` of the
 * previous one (in rendered pixels, left to right) staggers onto row 1 so
 * the two labels don't overlap. `trackWidthPx` is the timeline track's own
 * measured width -- 0 or less (no measurement yet, e.g. the first render
 * before a ResizeObserver has run) means nothing is staggered, rather than
 * guessing every mark collides.
 */
export function layoutMarkRows(marks: TimelineMark[], trackWidthPx: number): TimelineMarkRow[] {
  const sorted = [...marks].sort((a, b) => a.fraction - b.fraction)
  if (trackWidthPx <= 0) return sorted.map((m) => ({ ...m, row: 0 }))

  let lastRow0Fraction: number | null = null
  return sorted.map((mark) => {
    const collidesWithRow0 =
      lastRow0Fraction !== null &&
      (mark.fraction - lastRow0Fraction) * trackWidthPx < MARK_COLLISION_PX
    if (collidesWithRow0) return { ...mark, row: 1 }
    lastRow0Fraction = mark.fraction
    return { ...mark, row: 0 }
  })
}
