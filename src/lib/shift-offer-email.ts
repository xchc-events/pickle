import type { Mail } from './auth-email'

/**
 * The email `emailOffer` sends — see
 * src/app/(app)/roster/actions.ts. Pure, so what it says can be tested; the
 * sending is src/lib/email.ts.
 *
 * Deliberately plain, on the same reasoning as src/lib/auth-email.ts: a
 * venue email that looks like marketing is one that lands in a spam folder.
 * The colours are literal because mail clients do not read the app's
 * stylesheet; they match the accent in src/styles/tokens.css.
 */

const VENUE = 'XCHC · Ōtautahi Christchurch'

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function shiftOfferEmail({
  personName,
  role,
  eventName,
  when,
  times,
  hours,
  url,
}: {
  personName: string
  role: string
  eventName: string
  /** The night, already formatted — `dateLabel(event.date)`. */
  when: string
  /** The call, as clock times, when doors is decided; hours alone otherwise. */
  times: string | null
  hours: number
  url: string
}): Mail {
  const first = personName.trim().split(/\s+/)[0] || personName
  const call = times ? `${times} (${hours}h)` : `${hours}h`
  const greeting = `Kia ora ${first},`

  return {
    subject: `You're offered ${role} — ${eventName}`,
    text: [
      greeting,
      '',
      `You're offered ${role} on ${eventName}, ${when} — ${call}.`,
      '',
      url,
      '',
      'Press the link to confirm it, or say you can’t make this one.',
      'It works once and stops working in 7 days.',
    ].join('\n'),
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:460px;margin:0 auto;padding:24px;color:#1a1a1a">
        <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b6b6b;margin:0 0 4px">${escape(VENUE)}</p>
        <h1 style="font-size:20px;font-weight:500;margin:0 0 16px">You're offered ${escape(role)}</h1>
        <p style="font-size:15px;line-height:1.5;margin:0 0 20px;color:#1a1a1a">${escape(greeting)} you're offered <strong>${escape(role)}</strong> on ${escape(eventName)}, ${escape(when)} — ${escape(call)}.</p>
        <p style="margin:0 0 24px"><a href="${escape(url)}" style="display:inline-block;background:#5d5294;color:#fff;text-decoration:none;font-size:15px;padding:11px 20px;border-radius:6px">Respond to this offer</a></p>
        <p style="font-size:13px;line-height:1.5;margin:0 0 8px;color:#6b6b6b">Press the button to confirm it, or say you can’t make this one.</p>
        <p style="font-size:13px;line-height:1.5;margin:0 0 8px;color:#6b6b6b">It works once and stops working in 7 days.</p>
      </div>
    `,
  }
}
