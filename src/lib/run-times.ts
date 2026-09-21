import { nightsBetween } from './night'

/**
 * When a night starts and ends.
 *
 * Times stay '8:00pm'-shaped strings — `timeMinutes` in event-record.ts, the
 * licence gate, the roster and the till window all read them that way — but
 * an event can now start at any minute and end on any later night, rather
 * than picking from three fixed lists. This is the free-form parser for that
 * shape and the rules that used to come for free from the lists being fixed.
 */

/** '20:15' (an `<input type="time">` value) → '8:15pm'. Null for '' or anything else. */
export function clockFromInput(value: string): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value)
  if (!m) return null

  const h24 = Number(m[1])
  const minute = Number(m[2])
  if (h24 > 23 || minute > 59) return null

  const period = h24 < 12 ? 'am' : 'pm'
  const h12 = h24 % 12 || 12
  return `${h12}:${m[2]}${period}`
}

/**
 * Minutes after midnight, 0–1439, with NO carry past midnight.
 *
 * The same parse as `timeMinutes` in event-record.ts, minus the carry that
 * makes a "1:00am" bar close read as after an "11:00pm" one — that carry is
 * about ordering two independent times, and would be wrong here: a night's
 * hours are worked out from its own start and end dates, not from guessing
 * which side of midnight a bare clock reading falls on.
 */
export function minutesOfDay(label: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})(am|pm)$/.exec(label ?? '')
  if (!m) return null

  let h = Number(m[1]) % 12
  if (m[3] === 'pm') h += 12

  return h * 60 + Number(m[2])
}

/** '8:15pm' → '20:15', for an input's value. '' for null or anything unparseable. */
export function clockToInput(label: string | null | undefined): string {
  const minutes = minutesOfDay(label)
  if (minutes === null) return ''

  const h24 = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export const MAX_NIGHTS = 14

export interface RunTimes {
  date: Date // a night (UTC midnight — src/lib/night.ts)
  doors: string | null
  barClose: string | null
  endDate: Date | null // a night
  allOut: string | null
}
export type RunField = 'doors' | 'barClose' | 'endDate' | 'allOut'

/**
 * The end night when nobody typed one: the same night, or the next when
 * everyone is out at or before the hour the doors opened. Null unless both
 * times are known.
 */
export function endNightFor(date: Date, doors: string | null, allOut: string | null): Date | null {
  const doorsM = minutesOfDay(doors)
  const outM = minutesOfDay(allOut)
  if (doorsM === null || outM === null) return null

  const nextNight = outM <= doorsM
  return nextNight ? new Date(date.getTime() + 86_400_000) : date
}

/**
 * Everything wrong with a set of run times, one message a field. {} when
 * nothing is.
 *
 * A missing time or date is never an error here: a field left "not decided"
 * skips the rules that need it, rather than blocking on it. Instants are
 * `night + minutesOfDay`, plain UTC arithmetic — see src/lib/night.ts for why
 * that arithmetic never has to think about daylight saving.
 */
export function runProblems(r: RunTimes): Partial<Record<RunField, string>> {
  const problems: Partial<Record<RunField, string>> = {}

  const nights = r.endDate === null ? null : nightsBetween(r.date, r.endDate)
  if (nights !== null && nights < 0) {
    problems.endDate = 'The night cannot end before it starts.'
  } else if (nights !== null && nights > MAX_NIGHTS) {
    problems.endDate = 'That is more than two weeks from start to finish — check the dates.'
  }

  const doorsM = minutesOfDay(r.doors)
  const outM = minutesOfDay(r.allOut)
  if (doorsM !== null && outM !== null && nights !== null) {
    const end = nights * 1440 + outM
    if (end <= doorsM) {
      problems.allOut = 'Everyone out has to be after the doors open.'
    }
  }

  const closeM = minutesOfDay(r.barClose)
  if (doorsM !== null && closeM !== null) {
    if (closeM === doorsM) {
      problems.barClose = 'The bar closes after the doors open and before everyone is out.'
    } else {
      // The first time that clock reading comes round again after doors
      // open: later today if it is later in the day than doors, otherwise
      // it can only mean tomorrow.
      const closeNights = closeM > doorsM ? 0 : 1
      const closeInstant = closeNights * 1440 + closeM
      if (outM !== null && nights !== null) {
        const end = nights * 1440 + outM
        if (closeInstant > end) {
          problems.barClose = 'The bar closes after the doors open and before everyone is out.'
        }
      }
    }
  }

  return problems
}
