import NextAuth, { type NextAuthConfig } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Resend from 'next-auth/providers/resend'
import type { Adapter } from 'next-auth/adapters'
import { db } from './db'
import { mayAdmit, mayRequestLink, normaliseEmail } from './auth-rules'

/**
 * Real sign-in.
 *
 * One way in: a link emailed to the address an administrator put on the
 * account. No passwords, and no OAuth.
 *
 * The reasoning, since it was a real decision rather than a default. Google
 * would only serve the half of our users who are inside the venue — an
 * external promoter signing off a poster is not going to be in XCHC's
 * Workspace. Passwords look simpler than they are: reset needs email anyway,
 * so the email dependency does not go away, it just arrives after hashing,
 * reset tokens, strength rules and lockout have been built. And Auth.js
 * refuses database sessions for a credentials-only setup
 * (`@auth/core/lib/utils/assert.js`), which would cost us the property Admin
 * promises in its own copy: switching somebody off ends the session they
 * already have open. A JWT cannot be taken back.
 *
 * Sent through Resend rather than SMTP: the Nodemailer provider pulls in a
 * dependency carrying an unfixed high-severity advisory
 * (GHSA-p6gq-j5cr-w38f), and this repository is public. Resend's provider is
 * plain fetch.
 *
 * The single most important thing in this file is that **`createUser` throws**.
 *
 * With the stock adapter, anybody who can receive mail at any address becomes
 * a user of this product. That is right for a service people sign up to and
 * wrong for one venue's internal tool. An account here exists because an
 * administrator made it in Admin. Disabling creation at the adapter is what
 * makes that true rather than intended — a callback returning false can be
 * reordered or forgotten, but a `createUser` that cannot create is
 * load-bearing.
 */

/** No self-signup. See the note above — this is the security boundary. */
function noSignUpAdapter(): Adapter {
  const base = PrismaAdapter(db)

  return {
    ...base,
    createUser() {
      throw new Error(
        'ACCESS_DENIED: accounts are created by an administrator in Admin, not by signing in.',
      )
    },
  }
}

/**
 * How long a sign-in link lives.
 *
 * An hour, against Auth.js's default of a day. A link is a credential, and
 * one sitting unread in an inbox overnight is a credential sitting unread in
 * an inbox overnight. An hour is long enough to request it on a phone and
 * open it on the bar laptop, and short enough that a forwarded or forgotten
 * message stops being useful quickly.
 */
const LINK_TTL_SECONDS = 60 * 60

const APP_NAME = 'PicklePicklePickle'
const VENUE = 'XCHC · Ōtautahi Christchurch'

function linkEmail(url: string): { subject: string; html: string; text: string } {
  return {
    subject: `Your sign-in link for ${APP_NAME}`,
    text: [
      `Sign in to ${APP_NAME} (${VENUE})`,
      '',
      url,
      '',
      'This link works once and stops working in an hour.',
      'If you did not ask for it, nothing has happened and you can ignore this.',
    ].join('\n'),
    // Deliberately plain. A venue sign-in email that looks like marketing is
    // a venue sign-in email that lands in a spam folder.
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:460px;margin:0 auto;padding:24px;color:#1a1a1a">
        <p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b6b6b;margin:0 0 4px">${VENUE}</p>
        <h1 style="font-size:20px;font-weight:500;margin:0 0 16px">Sign in to ${APP_NAME}</h1>
        <p style="font-size:15px;line-height:1.5;margin:0 0 20px">Press the button and you are in. No password to remember.</p>
        <p style="margin:0 0 24px">
          <a href="${url}" style="display:inline-block;background:#5d5294;color:#fff;text-decoration:none;font-size:15px;padding:11px 20px;border-radius:6px">Sign in</a>
        </p>
        <p style="font-size:13px;line-height:1.5;color:#6b6b6b;margin:0 0 8px">This link works once and stops working in an hour.</p>
        <p style="font-size:13px;line-height:1.5;color:#6b6b6b;margin:0">If you did not ask for it, nothing has happened and you can ignore this.</p>
      </div>
    `,
  }
}

const providers: NextAuthConfig['providers'] = []

if (process.env.AUTH_RESEND_KEY && process.env.EMAIL_FROM) {
  providers.push(
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.EMAIL_FROM,
      maxAge: LINK_TTL_SECONDS,

      /**
       * Send the link, unless one has just gone out to this address.
       *
       * Auth.js writes the verification token before calling this, so the
       * throttle looks for an *older* token for the same address and derives
       * when it was issued from its expiry. Without this, the form will send
       * an unlimited number of real emails against a finite quota — which is
       * how somebody locks the venue out of its own tool without ever
       * getting in themselves.
       */
      async sendVerificationRequest({ identifier, provider, url, token }) {
        const previous = await db.verificationToken.findFirst({
          where: { identifier, token: { not: token } },
          orderBy: { expires: 'desc' },
          select: { expires: true },
        })

        const lastSentAt = previous
          ? new Date(previous.expires.getTime() - LINK_TTL_SECONDS * 1000)
          : null

        const verdict = mayRequestLink(lastSentAt, new Date())
        if (!verdict.ok) {
          // Auth.js turns a throw here into its Verification error, which the
          // sign-in page explains. Nothing is sent and nothing is charged.
          throw new Error(verdict.why)
        }

        const mail = linkEmail(url)
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from: provider.from, to: identifier, ...mail }),
        })

        if (!res.ok) {
          // The body carries Resend's own reason — an unverified sending
          // domain, most often. Worth having in the log verbatim.
          throw new Error(`Resend refused the message: ${await res.text()}`)
        }
      },
    }),
  )
}

/** Whether real sign-in is available at all on this install. */
export const authConfigured = providers.length > 0

export const config: NextAuthConfig = {
  adapter: noSignUpAdapter(),
  providers,
  session: {
    // Database sessions rather than JWT, so that switching somebody off in
    // Admin ends their session rather than waiting for a token to expire.
    // Staff turnover is the ordinary case at a venue, not the exception.
    strategy: 'database',
    maxAge: 60 * 60 * 24 * 30,
  },
  pages: {
    signIn: '/sign-in',
    error: '/sign-in',
    verifyRequest: '/sign-in?sent=1',
  },
  callbacks: {
    /**
     * The second gate.
     *
     * `createUser` above means an unknown address cannot become a user. This
     * additionally refuses a *known* address whose account has been switched
     * off, and normalises the email so case never decides whether somebody
     * gets in.
     */
    async signIn({ user }) {
      const email = user.email ? normaliseEmail(user.email) : null
      if (!email) return false

      const row = await db.user.findUnique({
        where: { email },
        select: { id: true, active: true },
      })

      const verdict = mayAdmit({ email, known: row !== null, active: row?.active ?? false })
      return verdict.ok
    },

    async session({ session, user }) {
      // The role travels on the session so the shell can draw itself, but
      // nothing trusts it: every permission decision re-reads the database.
      // See src/lib/permissions.ts.
      if (session.user) session.user.id = user.id
      return session
    },
  },
  trustHost: true,
}

export const { handlers, auth, signIn, signOut } = NextAuth(config)
