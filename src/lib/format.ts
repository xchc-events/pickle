/**
 * Display formatting, ported from the prototype's helpers.
 * Every money and hour figure in the UI goes through these.
 */

/** `$1,234`, `-$56`. Rounded to the dollar, en-NZ grouping. */
export const money = (n: number): string =>
  (n < -0.5 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-NZ')

/** `7.5h`. One decimal place. */
export const hrs = (n: number): string => `${Math.round(n * 10) / 10}h`

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * `Sat 6 Sep` — the venue's own shorthand, and what every screen shows.
 * Built by hand rather than through `toLocaleDateString`, which gives
 * "Sat, 6 Sept" in en-NZ and would drift with the platform's ICU data.
 */
export const dateLabel = (d: Date): string =>
  `${DOW[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`

/**
 * `just now`, `20 minutes ago`, `3 days ago`. What the activity feed and the
 * "ticked off by" lines read; the prototype stores the phrase, we derive it
 * so it cannot go stale.
 */
export function ago(then: Date, now: Date = new Date()): string {
  const mins = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const d = Math.floor(hours / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/** `3 days`, `1 day`. */
export const days = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`

/**
 * Initials from a name, for people who have no Person record — an external
 * coordinator is not venue staff and is never rostered, so they do not get
 * one. "Awhina Reid" becomes "AR".
 */
export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '\u2014'
