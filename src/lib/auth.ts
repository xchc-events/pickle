import NextAuth, { type NextAuthConfig } from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Google from 'next-auth/providers/google'
import Resend from 'next-auth/providers/resend'
import type { Adapter } from 'next-auth/adapters'
import { db } from './db'
import { mayAdmit, normaliseEmail } from './auth-rules'

/**
 * Real sign-in.
 *
 * Two providers, each switched on by whether it is configured:
 *
 *  - **Google**, for venue staff. XCHC is a Google Workspace organisation, so
 *    everybody internal already has an account and there is no password for
 *    the venue to look after or for anybody to lose.
 *  - **Email link**, for external promoters, who are not in the Workspace and
 *    should not be given a venue account just to sign off a poster. Sent
 *    through Resend rather than SMTP: the Nodemailer provider pulls in a
 *    dependency carrying an unfixed high-severity advisory (GHSA-p6gq-j5cr-w38f),
 *    and this repository is public. Resend's provider is plain fetch.
 *
 * The single most important thing in this file is that **`createUser` throws**.
 *
 * With the stock adapter, anybody with a Google account who reaches the
 * sign-in page becomes a user of this product. That is right for a service
 * people sign up to and wrong for one venue's internal tool. An account here
 * exists because an administrator made it in Admin; a provider vouching for
 * somebody's email is not the same as XCHC having decided they work here.
 * Disabling creation at the adapter is what makes that true rather than
 * intended — a callback returning false can be reordered or forgotten, but a
 * `createUser` that cannot create is load-bearing.
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

const providers: NextAuthConfig['providers'] = []

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Always show the chooser: venue laptops are shared, and silently
      // resuming the last person's session is how somebody ends up working
      // as a colleague without noticing.
      authorization: { params: { prompt: 'select_account' } },
    }),
  )
}

if (process.env.AUTH_RESEND_KEY && process.env.EMAIL_FROM) {
  providers.push(Resend({ apiKey: process.env.AUTH_RESEND_KEY, from: process.env.EMAIL_FROM }))
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
