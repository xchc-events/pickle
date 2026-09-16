import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { after } from 'next/server'
import { db } from './db'
import { hashToken, mintToken, tokenLooksValid } from './grants'
import { sessionCookie, sessionExpiry, sessionState, shouldTouchSession } from './auth-rules'
import type { SignInMethod } from '@/generated/prisma/client'

/**
 * Sessions.
 *
 * Two ways in, both built here rather than through a library: an email address
 * and password, or a single-use link emailed to the address on the account.
 * Either one ends the same way — a row in `Session` and a cookie holding the
 * token that row is the hash of.
 *
 * ## Why this is in-house
 *
 * Sign-in used to be Auth.js with an emailed link and nothing else, and the
 * note that stood here explained why passwords were left out. The venue then
 * decided it wanted passwords. Auth.js can check a password, but it will only
 * give a password sign-in a JWT — it refuses database sessions for
 * credentials (`@auth/core/lib/utils/assert.js`) — and a JWT cannot be taken
 * back. That would have cost the one property Admin promises in its own copy:
 * switching somebody off ends the session they already have open.
 *
 * So the session is ours. What it keeps from before, and why:
 *
 *  - **There is no self-signup.** Nothing in this file, or anywhere on the
 *    sign-in path, creates a User. An account exists because an administrator
 *    made it in Admin; a stranger with a perfectly good email address gets
 *    nothing.
 *  - **Sessions are rows, so they can be ended.** Switching somebody off,
 *    resetting a password and "sign out everywhere else" all delete rows, and
 *    the next request from those browsers is signed out.
 *  - **The database holds hashes, not tokens.** Like access grants: a copy of
 *    `Session` or `AuthToken` is a list, not a way in.
 *
 * And what it adds: a password check that is slow on purpose
 * (src/lib/password.ts), a wrong-password throttle counted from the audit trail
 * (`mayAttemptPassword`), links that survive an email scanner opening them
 * (src/app/sign-in/link/[token]), and a hard thirty-day limit on any session.
 *
 * Permission decisions never read anything off the session but the user id:
 * see `currentUser` in session.ts, which re-reads the account on every request.
 */

const cookieConfig = () => sessionCookie(process.env.AUTH_URL, process.env.NODE_ENV)

/** The attributes the cookie is set with, and must be cleared with. */
function cookieOptions(secure: boolean) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' }
}

/**
 * Sign this browser in as `userId`.
 *
 * Only ever called after a credential has been checked — a password in
 * `attemptPassword`, or a link spent in auth-data.ts. Whatever session the
 * browser already held is ended first, so a sign-in is always a fresh token and
 * never a promotion of one somebody else might have planted.
 */
export async function startSession(userId: string, method: SignInMethod): Promise<void> {
  const jar = await cookies()
  const { name, secure } = cookieConfig()

  const previous = jar.get(name)?.value
  if (previous && tokenLooksValid(previous)) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(previous) } })
  }

  const token = mintToken()
  const now = new Date()
  const expires = sessionExpiry(now)
  const userAgent = (await headers()).get('user-agent')?.slice(0, 300) ?? null

  await db.$transaction([
    db.session.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        method,
        userAgent,
        createdAt: now,
        lastSeenAt: now,
        expires,
      },
    }),
    db.user.update({ where: { id: userId }, data: { lastSignInAt: now } }),
  ])

  jar.set(name, token, { ...cookieOptions(secure), expires })
}

export interface CurrentSession {
  id: string
  userId: string
  method: SignInMethod
  createdAt: Date
}

/**
 * The session this request carries, if it is still good.
 *
 * Memoised per request: the layout, the page and every permission check ask,
 * and one lookup answers all of them.
 *
 * A session past either limit is treated as gone and its row cleared. The
 * cookie cannot be cleared from here — a server component cannot set cookies —
 * but it no longer matches anything, which is the part that matters.
 */
export const currentSession = cache(async (): Promise<CurrentSession | null> => {
  const jar = await cookies()
  const token = jar.get(cookieConfig().name)?.value
  if (!token || !tokenLooksValid(token)) return null

  const row = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      userId: true,
      method: true,
      createdAt: true,
      expires: true,
      lastSeenAt: true,
    },
  })
  if (!row) return null

  const now = new Date()
  if (sessionState(row, now) !== 'live') {
    after(() => db.session.deleteMany({ where: { id: row.id } }))
    return null
  }

  // Written after the response, and at most hourly, so reading a page is not
  // a database write.
  if (shouldTouchSession(row.lastSeenAt, now)) {
    after(() => db.session.updateMany({ where: { id: row.id }, data: { lastSeenAt: now } }))
  }

  return { id: row.id, userId: row.userId, method: row.method, createdAt: row.createdAt }
})

/**
 * Sign this browser out: delete the session row and clear the cookie.
 *
 * The row is what matters. Clearing a cookie only asks the browser to forget;
 * deleting the row means the token is dead even if it was copied somewhere.
 */
export async function endCurrentSession(): Promise<{ userId: string; email: string } | null> {
  const jar = await cookies()
  const { name, secure } = cookieConfig()
  const token = jar.get(name)?.value

  // Cleared with the attributes it was set with. A browser ignores a
  // Set-Cookie for a `__Host-` name unless it is Secure with path `/`, and
  // that includes the one meant to delete it.
  jar.delete({ name, ...cookieOptions(secure) })

  if (!token || !tokenLooksValid(token)) return null

  const row = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, user: { select: { email: true } } },
  })
  if (!row) return null

  await db.session.deleteMany({ where: { id: row.id } })
  return { userId: row.userId, email: row.user.email }
}
