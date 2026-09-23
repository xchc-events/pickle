import type { Mail } from './auth-email'

/**
 * The venue spec sheet: which components go out, in what order, and what it
 * reads like assembled — pure and tested here, over the rows
 * src/lib/venue-spec-data.ts reads and writes.
 *
 * Connor, 23 Sep 2026: "It'd be better to have a more full-featured option
 * where you can select which components of a venue spec sheet you're
 * sending out, as not all of them are relevant to all people." Tech ticks
 * components and recipients; this is what turns a tick-list into the
 * message that actually goes out.
 */

export interface VenueSpecComponentRow {
  key: string
  title: string
  body: string
  order: number
  active: boolean
}

/** What Tech offers to tick: active components, house order. */
export function tickableComponents(
  components: readonly VenueSpecComponentRow[],
): VenueSpecComponentRow[] {
  return components.filter((c) => c.active).sort((a, b) => a.order - b.order)
}

/**
 * The assembled text: exactly the ticked components, in house order — never
 * the order they happened to be ticked in, and never an inactive one even if
 * an old send's `componentKeys` still names it. Blank line between a title
 * and its body, two between sections, so a plain-text inbox reads it as
 * sections rather than one paragraph.
 */
export function assembleVenueSpecText(
  components: readonly VenueSpecComponentRow[],
  tickedKeys: readonly string[],
): string {
  const ticked = new Set(tickedKeys)
  return tickableComponents(components)
    .filter((c) => ticked.has(c.key))
    .map((c) => `${c.title}\n${c.body}`)
    .join('\n\n')
}

export interface SpecRecipient {
  payeeId: string
  name: string
  email: string | null
}

/**
 * Which ticked recipients cannot actually be sent to — no email on file.
 * Named so the refusal can name them, rather than saying "somebody".
 */
export function recipientsMissingEmail(
  recipients: readonly SpecRecipient[],
  tickedPayeeIds: readonly string[],
): SpecRecipient[] {
  const ticked = new Set(tickedPayeeIds)
  return recipients.filter((r) => ticked.has(r.payeeId) && !r.email)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * The email a venue spec send actually goes out as. Plain and informational
 * — nobody is being asked to click anything, so this skips the button
 * template src/lib/auth-email.ts uses for a credential and just wraps the
 * assembled text.
 */
export function venueSpecEmail(eventName: string, text: string): Mail {
  return {
    subject: `Venue spec — ${eventName}`,
    text: [`The venue spec for ${eventName}, from XCHC · Ōtautahi Christchurch.`, '', text].join(
      '\n',
    ),
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a">
        <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b6b6b;margin:0 0 4px">XCHC · Ōtautahi Christchurch</p>
        <h1 style="font-size:20px;font-weight:500;margin:0 0 16px">Venue spec — ${escapeHtml(eventName)}</h1>
        <pre style="font:14px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;white-space:pre-wrap;margin:0">${escapeHtml(text)}</pre>
      </div>
    `,
  }
}
