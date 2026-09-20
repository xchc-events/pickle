/**
 * A night, and the one instant it is stored as.
 *
 * `Event.date` and `Hold.date` are DateTime columns holding an evening, not an
 * instant, and until events could be made in the app nothing had to say which
 * instant that is: the seed wrote local noon on whatever machine ran it. Two
 * things make the choice matter.
 *
 * The app runs in two timezones — Pacific/Auckland on the machines it is built
 * on, UTC on CI and on Cloudflare Workers — and everything that reads a date
 * (`dateLabel`, `daysBetween`, the day's share of the weekly costs) uses local
 * getters. And the hold ladder matches a night by exact equality
 * (src/lib/holds-data.ts), so two bookings on the same Saturday that stored
 * different instants would each hold the room without either ladder seeing the
 * other. Every event on a night has to store the same one.
 *
 * So a night is **UTC midnight of its calendar date**. It is the one instant
 * that reads as the right date through local getters in both zones — in
 * Christchurch it is noon, or 1pm in summer, of the same day — and through UTC
 * getters anywhere. Noon UTC, the usual way to dodge this, is already tomorrow
 * in Christchurch.
 *
 * Pure, so the rule can be tested either side of midnight and either side of
 * daylight saving without a clock.
 */

/** Where the venue is. "Today" is Christchurch's today, wherever the server runs. */
export const VENUE_TZ = 'Pacific/Auckland'

/** UTC midnight of a calendar date. `monthIndex` is 0-based, like Date. */
export function nightOf(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day))
}

/**
 * The night an `<input type="date">` names, or null.
 *
 * Strict about the shape — `YYYY-MM-DD` and nothing else — and about the date
 * being real: Date rolls 30 February over into March rather than refusing it,
 * so the parts are read back and compared.
 */
export function nightFromInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null

  const year = Number(m[1])
  const monthIndex = Number(m[2]) - 1
  const day = Number(m[3])
  const night = nightOf(year, monthIndex, day)

  const real =
    night.getUTCFullYear() === year &&
    night.getUTCMonth() === monthIndex &&
    night.getUTCDate() === day
  return real ? night : null
}

/** A night as `YYYY-MM-DD`, for a date input's value or its `min`. */
export function nightInput(night: Date): string {
  const year = String(night.getUTCFullYear()).padStart(4, '0')
  const month = String(night.getUTCMonth() + 1).padStart(2, '0')
  const day = String(night.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Tonight at the venue.
 *
 * Asked of `Intl` in the venue's own timezone rather than worked out from the
 * server's clock: at nine on a Saturday morning in Christchurch it is still
 * Friday in UTC, and a server that thought so would let a promoter book last
 * night.
 */
export function venueToday(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VENUE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: 'year' | 'month' | 'day') => Number(parts.find((p) => p.type === type)?.value)

  return nightOf(part('year'), part('month') - 1, part('day'))
}

/**
 * Whole nights from one night to another, negative when `to` is the earlier.
 *
 * Nights are all UTC midnights, so this is plain arithmetic — daylight saving
 * never comes into it, which is half the reason for storing them that way.
 */
export function nightsBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

/**
 * The night for the *local* calendar date of an instant.
 *
 * For the seed, which counts days out from today on the machine running it and
 * then has to store what the enquiry form would have stored for that date.
 */
export function nightOfLocal(d: Date): Date {
  return nightOf(d.getFullYear(), d.getMonth(), d.getDate())
}
