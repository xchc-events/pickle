import 'server-only'
import type { Mail } from './auth-email'

/**
 * Sending email.
 *
 * Through Resend's HTTP API rather than SMTP: the Nodemailer route pulls in a
 * dependency carrying an unfixed high-severity advisory (GHSA-p6gq-j5cr-w38f),
 * and this repository is public. This is plain fetch.
 *
 * Sends from `EMAIL_FROM`, which is on a Minim domain on purpose — XCHC's own
 * web presence may move around launch. See the README.
 */

/** Whether mail can actually leave this install. */
export function emailConfigured(): boolean {
  return Boolean(process.env.AUTH_RESEND_KEY && process.env.EMAIL_FROM)
}

/**
 * `sent` went to Resend. `logged` did not leave the machine: outside
 * production, with no keys, the message is written to the dev server's log
 * instead, so invitations and resets can be followed through locally. Its
 * link is live — which is fine on a laptop and is exactly why production
 * refuses rather than logs.
 */
export type Delivery = 'sent' | 'logged'

export async function sendMail(to: string, mail: Mail): Promise<Delivery> {
  if (!emailConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Email is not configured: set AUTH_RESEND_KEY and EMAIL_FROM. Nothing was sent.',
      )
    }
    console.info(
      [
        '',
        '┌─ email · not sent: AUTH_RESEND_KEY is not set, so it is written here instead',
        `│ To:      ${to}`,
        `│ Subject: ${mail.subject}`,
        '│',
        ...mail.text.split('\n').map((line) => `│ ${line}`),
        '└─',
        '',
      ].join('\n'),
    )
    return 'logged'
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, ...mail }),
  })

  if (!res.ok) {
    // The body carries Resend's own reason — an unverified sending domain,
    // most often. Worth having in the log verbatim.
    throw new Error(`Resend refused the message: ${await res.text()}`)
  }
  return 'sent'
}
