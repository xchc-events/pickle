/**
 * Display formatting, ported from the prototype's helpers.
 * Every money and hour figure in the UI goes through these.
 */

/** `$1,234`, `-$56`. Rounded to the dollar, en-NZ grouping. */
export const money = (n: number): string =>
  (n < -0.5 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-NZ')

/** `7.5h`. One decimal place. */
export const hrs = (n: number): string => `${Math.round(n * 10) / 10}h`

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
