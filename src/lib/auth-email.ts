import { TOKEN_TTL_SECONDS } from './auth-rules'

/**
 * The emails sign-in sends, as data.
 *
 * Pure, so what they say can be tested — the sending is src/lib/email.ts.
 *
 * All four are deliberately plain. A venue sign-in email that looks like
 * marketing is a venue sign-in email that lands in a spam folder, and one
 * that looks like every phishing email ("Action required!") teaches people to
 * click those. The colours are literal because mail clients do not read the
 * app's stylesheet; they match the accent in src/styles/tokens.css.
 */

export interface Mail {
  subject: string
  text: string
  html: string
}

const APP = 'PicklePicklePickle'
const VENUE = 'XCHC · Ōtautahi Christchurch'

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** "an hour", "7 days" — read off the token lifetimes, so the copy cannot drift from them. */
function lifetime(seconds: number): string {
  if (seconds === 3600) return 'an hour'
  if (seconds % 86400 === 0) return `${seconds / 86400} days`
  return `${Math.round(seconds / 60)} minutes`
}

function page(heading: string, paragraphs: string[], button?: { label: string; url: string }) {
  const p = (s: string, muted = false) =>
    `<p style="font-size:${muted ? 13 : 15}px;line-height:1.5;margin:0 0 ${muted ? 8 : 20}px;color:${muted ? '#6b6b6b' : '#1a1a1a'}">${s}</p>`

  const [lead, ...rest] = paragraphs
  return `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:460px;margin:0 auto;padding:24px;color:#1a1a1a">
        <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b6b6b;margin:0 0 4px">${VENUE}</p>
        <h1 style="font-size:20px;font-weight:500;margin:0 0 16px">${heading}</h1>
        ${lead ? p(lead) : ''}
        ${
          button
            ? `<p style="margin:0 0 24px"><a href="${escape(button.url)}" style="display:inline-block;background:#5d5294;color:#fff;text-decoration:none;font-size:15px;padding:11px 20px;border-radius:6px">${button.label}</a></p>`
            : ''
        }
        ${rest.map((s) => p(s, true)).join('\n        ')}
      </div>
    `
}

export function signInLinkEmail(url: string): Mail {
  const life = lifetime(TOKEN_TTL_SECONDS.SIGN_IN)
  return {
    subject: `Your sign-in link for ${APP}`,
    text: [
      `Sign in to ${APP} (${VENUE})`,
      '',
      url,
      '',
      `This link works once and stops working in ${life}.`,
      'If you did not ask for it, nothing has happened and you can ignore this.',
    ].join('\n'),
    html: page(
      `Sign in to ${APP}`,
      [
        'Press the button and you are in.',
        `This link works once and stops working in ${life}.`,
        'If you did not ask for it, nothing has happened and you can ignore this.',
      ],
      { label: 'Sign in', url },
    ),
  }
}

export function inviteEmail({ url, name }: { url: string; name: string | null }): Mail {
  const life = lifetime(TOKEN_TTL_SECONDS.INVITE)
  const first = name?.trim().split(/\s+/)[0]
  const greeting = first ? `Kia ora ${first},` : 'Kia ora,'

  return {
    subject: `Choose your password for ${APP}`,
    text: [
      greeting,
      '',
      `XCHC has an account for you on ${APP}, the venue's events tool. Choose a password to sign in with:`,
      '',
      url,
      '',
      `This link works once and lasts ${life}. After that, sign in with this email address and the password you chose.`,
      'If you were not expecting this, you can ignore it — nothing happens until the link is used.',
    ].join('\n'),
    html: page(
      `Choose your password for ${APP}`,
      [
        `${escape(greeting)} XCHC has an account for you on ${APP}, the venue's events tool. Choose a password to sign in with.`,
        `This link works once and lasts ${life}. After that, sign in with this email address and the password you chose.`,
        'If you were not expecting this, you can ignore it — nothing happens until the link is used.',
      ],
      { label: 'Choose a password', url },
    ),
  }
}

export function resetEmail(url: string): Mail {
  const life = lifetime(TOKEN_TTL_SECONDS.RESET)
  return {
    subject: `Set a new password for ${APP}`,
    text: [
      `Set a new password for ${APP} (${VENUE})`,
      '',
      url,
      '',
      `This link works once and stops working in ${life}. Setting a new password signs you out everywhere else.`,
      'If you did not ask for this, ignore it — your password has not changed and still works.',
    ].join('\n'),
    html: page(
      'Set a new password',
      [
        `Somebody asked to set a new password for your ${APP} account. If that was you, press the button.`,
        `This link works once and stops working in ${life}. Setting a new password signs you out everywhere else.`,
        'If you did not ask for this, ignore it — your password has not changed and still works.',
      ],
      { label: 'Set a new password', url },
    ),
  }
}

/** "16 September 2026, 8:30 pm", in the venue's time zone rather than the server's. */
function venueTime(when: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-NZ', {
      timeZone: 'Pacific/Auckland',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .formatToParts(when)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`
}

/**
 * Sent whenever a password changes, however it changed.
 *
 * If it was not the account's owner, this is how they find out, so it says
 * what to do next. It carries no token: the way back is the ordinary "forgot
 * your password" page, which a hijacker cannot stop them using.
 */
export function passwordChangedEmail({ when, forgotUrl }: { when: Date; forgotUrl: string }): Mail {
  const at = venueTime(when)
  return {
    subject: `Your ${APP} password was changed`,
    text: [
      `The password for your ${APP} account was changed on ${at}.`,
      '',
      'If that was you, there is nothing to do.',
      '',
      `If it was not you, set a new one straight away — it signs everybody else out: ${forgotUrl}`,
      'Then tell an administrator at the venue.',
    ].join('\n'),
    html: page('Your password was changed', [
      `The password for your ${APP} account was changed on ${escape(at)}. If that was you, there is nothing to do.`,
      `If it was not you, <a href="${escape(forgotUrl)}" style="color:#5d5294">set a new one straight away</a> — it signs everybody else out. Then tell an administrator at the venue.`,
    ]),
  }
}
