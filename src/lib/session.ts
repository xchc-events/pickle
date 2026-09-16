import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { db } from './db'
import { currentSession } from './auth'
import type { Role } from '@/generated/prisma/client'
import type { RoleKey } from './constants'
import { initialsOf } from './format'

/**
 * The signed-in user.
 *
 * Two ways in, and the difference between them is recorded on the result
 * rather than assumed:
 *
 *  - A **real session** (src/lib/auth.ts), opened with a password or an
 *    emailed link — a credential the person actually holds. `authenticated`
 *    is true, and `sessionId` names the session.
 *  - The **development role picker**, a cookie carrying a user id and nothing
 *    else. Anyone who can set it can be anyone, so it is refused outright
 *    outside development, and where it is allowed `authenticated` is false.
 *
 * That flag is not decoration. `canReveal` in payments.ts refuses to decrypt
 * a bank account without it, so the stub can be used to build and demonstrate
 * every module without it ever being enough to open somebody's payment
 * details in production.
 *
 * What has always been true and stays true: the *server* decides what a user
 * can see. Nothing here is read from the session token; the row is fetched
 * fresh, so switching somebody off in Admin takes effect on their next
 * request rather than whenever a token happens to expire.
 */

export const SESSION_COOKIE = 'pickle_uid'

export type SessionUser = {
  id: string
  /** The address on the account — what they sign in with, and where links go. */
  email: string
  name: string
  role: Role
  roleKey: RoleKey
  /**
   * The organisation an external promoter acts for. This — not the name
   * beside it — is what `eventScope` narrows every event query by.
   */
  organisationId: string | null
  /** The organisation's name, for display only. Never used to scope. */
  organisationName: string | null
  external: boolean
  /** The person record behind the account, when there is one. */
  personId: string | null
  initials: string
  /** Whether a real credential backs this request. False for the dev stub. */
  authenticated: boolean
  /** The session behind the request. Null for the dev stub, which has none. */
  sessionId: string | null
}

export const roleKeyOf = (role: Role): RoleKey => role.toLowerCase() as RoleKey

/** The dev role picker is only ever available outside production. */
export const stubAllowed = process.env.NODE_ENV !== 'production'

const USER_INCLUDE = {
  person: true,
  organisation: { select: { id: true, name: true } },
} as const

type Row = NonNullable<Awaited<ReturnType<typeof db.user.findFirst>>> & {
  person?: { name: string; initials: string } | null
  organisation?: { id: string; name: string } | null
}

function shape(u: Row, sessionId: string | null): SessionUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name ?? u.person?.name ?? u.email,
    role: u.role,
    roleKey: roleKeyOf(u.role),
    organisationId: u.organisation?.id ?? null,
    organisationName: u.organisation?.name ?? null,
    external: u.role === 'PROMOTER',
    personId: u.personId,
    initials: u.person?.initials ?? initialsOf(u.name ?? u.email),
    authenticated: sessionId !== null,
    sessionId,
  }
}

/** Memoised per request, like the session under it. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  // A real session wins wherever there is one.
  const session = await currentSession()
  if (session) {
    const u = await db.user.findFirst({
      where: { id: session.userId, active: true },
      include: USER_INCLUDE,
    })
    if (u) return shape(u, session.id)

    // A live session whose account has since been switched off. Falling
    // through to the stub here would quietly re-admit them, so stop.
    return null
  }

  if (!stubAllowed) return null

  const jar = await cookies()
  const id = jar.get(SESSION_COOKIE)?.value
  if (!id) return null

  const u = await db.user.findFirst({ where: { id, active: true }, include: USER_INCLUDE })
  if (!u) return null

  return shape(u, null)
})
