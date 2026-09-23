import type { Mail } from './auth-email'

/**
 * The tech run sheet: the rows a new event starts from, and what they read
 * like sent to the promoter — pure and tested here, over the rows
 * src/lib/run-sheet-data.ts reads and writes.
 *
 * Connor, 23 Sep 2026: "A section here which allows you to fill in a run
 * sheet, like a tech run sheet, would be really helpful. And then sending
 * that to the promoter."
 */

export interface RunSheetRow {
  /** Null for a seeded row nobody has saved yet — see `seedRunSheetRows`. */
  id: string | null
  /** A clock string, '8:00pm'-shaped — src/lib/run-times.ts. */
  time: string | null
  item: string
  who: string | null
  note: string | null
  order: number
}

export interface EventRunTimes {
  packIn: string | null
  doors: string | null
  barClose: string | null
  allOut: string | null
  packOut: string | null
}

/**
 * The rows a new event's run sheet starts from: its own times, in the order
 * Roster already prints them (see docs/design-handoff/README.md, "Roster") —
 * pack-in, doors, bar close, everyone out, pack-out. A time the event has
 * not set yet gets no row; the tech lead adds one by hand if they want it
 * regardless. Every seeded row has `id: null`, since nothing has been saved
 * yet — `saveRunSheet` in src/app/(app)/tech/actions.ts is what turns a seed
 * into rows that exist.
 */
export function seedRunSheetRows(times: EventRunTimes): RunSheetRow[] {
  const seeds: { field: keyof EventRunTimes; item: string }[] = [
    { field: 'packIn', item: 'Pack-in' },
    { field: 'doors', item: 'Doors' },
    { field: 'barClose', item: 'Bar close' },
    { field: 'allOut', item: 'Everyone out' },
    { field: 'packOut', item: 'Pack-out' },
  ]

  return seeds
    .filter((s) => times[s.field] !== null)
    .map((s, i) => ({
      id: null,
      time: times[s.field],
      item: s.item,
      who: null,
      note: null,
      order: i,
    }))
}

/** `8:00pm — Doors — Door team — bring extra barriers`. Blank fields drop out. */
function lineFor(row: Pick<RunSheetRow, 'time' | 'item' | 'who' | 'note'>): string {
  return [row.time ?? '—', row.item, row.who, row.note].filter((s) => s && s.trim()).join(' — ')
}

/**
 * The assembled text: one line per row, in row order — sorted here rather
 * than trusted, so a caller does not have to get that right first.
 */
export function assembleRunSheetText(rows: readonly RunSheetRow[]): string {
  return [...rows]
    .sort((a, b) => a.order - b.order)
    .map(lineFor)
    .join('\n')
}

/**
 * The email a run sheet send actually goes out as. Plain and informational,
 * the same reasoning as `venueSpecEmail` in src/lib/venue-spec.ts.
 */
export function runSheetEmail(eventName: string, text: string): Mail {
  return {
    subject: `Run sheet — ${eventName}`,
    text: [`The run sheet for ${eventName}, from XCHC · Ōtautahi Christchurch.`, '', text].join(
      '\n',
    ),
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
        <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b6b6b;margin:0 0 4px">XCHC · Ōtautahi Christchurch</p>
        <h1 style="font-size:20px;font-weight:500;margin:0 0 16px">Run sheet — ${escapeHtml(eventName)}</h1>
        <pre style="font:14px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;white-space:pre-wrap;margin:0">${escapeHtml(text)}</pre>
      </div>
    `,
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
