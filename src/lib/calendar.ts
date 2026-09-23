/**
 * Calendar geometry for the Pipeline's Month and Week views.
 *
 * Both views start from the same `PipelineEvent[]` the Matrix reads
 * (`loadPipeline(user)` in pipeline-data.ts) — nothing here talks to the
 * database, and nothing here decides who can see what; that is `eventScope`
 * in src/lib/scope.ts, already applied before these rows ever arrive. This
 * file only turns that plain list into two grids: a month of Monday-first
 * weeks, and a week of hour-tall day columns.
 *
 * Every date in and out of this file is a *night* — UTC midnight of a
 * calendar date, see src/lib/night.ts — so every read here uses the UTC
 * getters, the one reading that is right regardless of which timezone the
 * process happens to be running in. "Today" is never asked for in here:
 * callers pass it in (`venueToday()`, from night.ts), so every function
 * below is pure and deterministic without mocking a clock.
 */

import { nightOf, nightsBetween } from './night'
import { minutesOfDay } from './run-times'
import type { PipelineEvent } from './pipeline'

const DAY_MS = 86_400_000
const MINUTES_PER_DAY = 1440

const sameNight = (a: Date, b: Date): boolean => nightsBetween(a, b) === 0

// ------------------------------------------------------------------ month --

export interface CalendarDay {
  /** The night this cell is for. */
  date: Date
  /** False for the lead-in/lead-out days from the months either side. */
  inMonth: boolean
  isToday: boolean
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * The Monday-first grid for a month: every night in it, plus the lead-in and
 * lead-out nights needed either side to fill whole weeks — a month never
 * starts on a Monday or ends on a Sunday, but a seven-column grid needs
 * both. `monthIndex` is 0-based, like `Date`, and both it and `year` are
 * normalised through `nightOf`, so passing 12 for "the month after
 * December" rolls into January of the next year rather than producing a
 * broken grid.
 */
export function monthGrid(year: number, monthIndex: number, today: Date): CalendarDay[] {
  const first = nightOf(year, monthIndex, 1)
  const targetYear = first.getUTCFullYear()
  const targetMonth = first.getUTCMonth()

  const leadIn = (first.getUTCDay() + 6) % 7 // Monday = 0 .. Sunday = 6
  const start = new Date(first.getTime() - leadIn * DAY_MS)

  const lastOfMonth = new Date(nightOf(year, monthIndex + 1, 1).getTime() - DAY_MS)
  const leadOut = 6 - ((lastOfMonth.getUTCDay() + 6) % 7)
  const end = new Date(lastOfMonth.getTime() + leadOut * DAY_MS)

  const days: CalendarDay[] = []
  for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
    const date = new Date(t)
    days.push({
      date,
      inMonth: date.getUTCFullYear() === targetYear && date.getUTCMonth() === targetMonth,
      isToday: sameNight(date, today),
    })
  }
  return days
}

/** "September 2026". Normalised through `nightOf`, the same as `monthGrid`. */
export function monthLabel(year: number, monthIndex: number): string {
  const d = nightOf(year, monthIndex, 1)
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/**
 * "2026-09" → the month it names, or null for anything else — reads the
 * month view's query-string param. `monthIndex` comes back 0-based.
 */
export function monthFromInput(
  value: string | undefined,
): { year: number; monthIndex: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? '')
  if (!m) return null
  const monthIndex = Number(m[2]) - 1
  if (monthIndex < 0 || monthIndex > 11) return null
  return { year: Number(m[1]), monthIndex }
}

/** The inverse of `monthFromInput`: "2026-09". Normalised through `nightOf`,
 *  so prev/next links can pass `monthIndex - 1` or `+ 1` straight through. */
export function monthToInput(year: number, monthIndex: number): string {
  const d = nightOf(year, monthIndex, 1)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Which of `events` fall on `day`, by `date`..`endDate` inclusive (`endDate`
 * defaults to `date` for a one-night event) — so a run that crosses a
 * calendar date, whether a small-hours finish or a true multi-night
 * booking, lists on every date it touches. Generic over whatever shape of
 * event is passed in, so a test fixture only needs the two date fields.
 */
export function eventsOnDay<T extends Pick<PipelineEvent, 'date' | 'endDate'>>(
  events: T[],
  day: Date,
): T[] {
  return events.filter((e) => {
    const end = e.endDate ?? e.date
    return nightsBetween(e.date, day) >= 0 && nightsBetween(day, end) >= 0
  })
}

// ------------------------------------------------------------------- week --

export interface WeekDay {
  date: Date
  isToday: boolean
}

/** Monday-first, the seven nights of the week `monday` starts. */
export function weekDays(monday: Date, today: Date): WeekDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday.getTime() + i * DAY_MS)
    return { date, isToday: sameNight(date, today) }
  })
}

/** `date` stepped by whole nights — negative to go back, for the week
 *  view's previous/next links. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

/** The Monday on or before `date` — normalises any night to its week. */
export function mondayOf(date: Date): Date {
  const offset = (date.getUTCDay() + 6) % 7
  return new Date(date.getTime() - offset * DAY_MS)
}

/**
 * "12am", "1am", … "11pm" — the week view's hour axis, in the venue's own
 * lower-case, no-leading-zero clock style rather than a bare 24-hour number.
 */
export function hourLabel(hour: number): string {
  const period = hour < 12 ? 'am' : 'pm'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}${period}`
}

/**
 * The default evening window a block draws when an event has set neither
 * pack times nor doors and everyone-out — the week view still has to put
 * the block somewhere. Four hours in the evening reads as a placeholder
 * rather than a real committed 8pm–1am night, and `runWindow`'s `defaulted`
 * flag is what tells the block to say so rather than print these as if they
 * were decided.
 */
export const DEFAULT_START = '7:00pm'
export const DEFAULT_END = '11:00pm'

export interface RunWindow {
  start: string
  end: string
  /** True when neither pack times nor doors/everyone-out were set, so this
   *  is `DEFAULT_START`–`DEFAULT_END`, not the event's own times. */
  defaulted: boolean
}

/**
 * The clock strings a block draws from: pack-in/pack-out first, since that
 * is the room's own commitment once both are decided; doors/everyone-out
 * next; the default window last. Mirrors the fallback `runLine` already
 * uses to decide when pack times are worth printing (pipeline.ts) — a lone
 * pack time reads as one edge of a block nobody can place yet, so it is
 * skipped the same way here, falling through to doors/everyone-out.
 */
export function runWindow(
  e: Pick<PipelineEvent, 'doors' | 'allOut' | 'packIn' | 'packOut'>,
): RunWindow {
  if (e.packIn && e.packOut) return { start: e.packIn, end: e.packOut, defaulted: false }
  if (e.doors && e.allOut) return { start: e.doors, end: e.allOut, defaulted: false }
  return { start: DEFAULT_START, end: DEFAULT_END, defaulted: true }
}

export interface BlockFraction {
  /** 0–1, the block's distance from midnight. */
  top: number
  /** 0–1, the block's own span. */
  height: number
  /** True when `endLabel` reads as at or before `startLabel` — the run
   *  crosses midnight, and the block is clipped there rather than drawn
   *  past it. */
  clipped: boolean
}

/**
 * A block's position and height as fractions of a 24-hour day, from
 * `startLabel` to `endLabel` (`'8:00pm'`-shaped, read with `minutesOfDay` —
 * see run-times.ts; nothing here parses a clock string itself).
 *
 * A run past midnight could read either of two ways: split the block across
 * the boundary into the next day's column, or clip it at midnight and say
 * how much further it runs. This clips. An event's block is one element the
 * day's `href` and hover point at, and splitting it would make it two
 * elements some nights and one on others — for a case the Month view
 * already shows in full, since every date a run touches gets its own card
 * there. `clipped` tells the caller to add the "→ 1:00 am" label rather
 * than draw the block as if it read the true end time.
 */
export function blockFraction(startLabel: string, endLabel: string): BlockFraction {
  const startM = minutesOfDay(startLabel) ?? 0
  const endRaw = minutesOfDay(endLabel) ?? MINUTES_PER_DAY
  const clipped = endRaw <= startM
  const endM = clipped ? MINUTES_PER_DAY : endRaw
  return { top: startM / MINUTES_PER_DAY, height: (endM - startM) / MINUTES_PER_DAY, clipped }
}

/**
 * The clock label a block prints: the plain range, "→ 1:00 am" once it is
 * clipped (the brief's own example — the block's top edge already says
 * where it started; the label only has to say how much further it runs),
 * or "Times not set" once it is the default window, so nobody mistakes a
 * placeholder for a decided time.
 */
export function blockLabel(
  startLabel: string,
  endLabel: string,
  clipped: boolean,
  defaulted: boolean,
): string {
  if (defaulted) return 'Times not set'
  return clipped ? `→ ${endLabel}` : `${startLabel} – ${endLabel}`
}

export interface WeekBlock<T> {
  event: T
  /** 0–1, from `blockFraction`. */
  top: number
  height: number
  clipped: boolean
  defaulted: boolean
  label: string
  startLabel: string
  endLabel: string
  /** 0-based column this block sits in, among the events it overlaps. */
  lane: number
  /** How many lanes that overlap group needs — the block's width is
   *  `1 / lanes`, its left offset `lane / lanes`. */
  lanes: number
}

/**
 * The blocks for one day column: every event whose night is `day`, laid out
 * so two that overlap sit side by side rather than on top of one another —
 * "never refused" (the brief's words) — through the same lane-assignment a
 * day-view calendar usually needs: sweep the blocks in start order, hand
 * each the lowest lane number nothing still open is using, and once a whole
 * chain of overlaps has closed, size every block in it to that chain's own
 * peak width rather than the grid's.
 *
 * A multi-night run's block is only ever drawn on its start night — see
 * `blockFraction` for why a run past midnight clips rather than splits;
 * the same reasoning extends to a run of several nights, and the Month view
 * is where the rest of its span shows.
 */
export function dayBlocks<
  T extends Pick<PipelineEvent, 'date' | 'doors' | 'allOut' | 'packIn' | 'packOut'>,
>(events: T[], day: Date): WeekBlock<T>[] {
  const blocks = events
    .filter((e) => sameNight(e.date, day))
    .map((e) => {
      const w = runWindow(e)
      const g = blockFraction(w.start, w.end)
      return {
        event: e,
        top: g.top,
        height: g.height,
        clipped: g.clipped,
        defaulted: w.defaulted,
        label: blockLabel(w.start, w.end, g.clipped, w.defaulted),
        startLabel: w.start,
        endLabel: w.end,
        lane: 0,
        lanes: 1,
      }
    })
    .sort((a, b) => a.top - b.top || b.height - a.height)

  let active: { end: number; lane: number }[] = []
  let group: typeof blocks = []

  const closeGroup = () => {
    const lanes = Math.max(1, ...group.map((b) => b.lane + 1))
    for (const b of group) b.lanes = lanes
    group = []
  }

  for (const block of blocks) {
    active = active.filter((a) => a.end > block.top)
    if (active.length === 0 && group.length > 0) closeGroup()

    const used = new Set(active.map((a) => a.lane))
    let lane = 0
    while (used.has(lane)) lane++

    block.lane = lane
    active.push({ end: block.top + block.height, lane })
    group.push(block)
  }
  closeGroup()

  return blocks
}
