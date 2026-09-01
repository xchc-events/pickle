import 'server-only'
import { cookies } from 'next/headers'
import { db } from './db'
import { auth, authConfigured } from './auth'
import type { Role } from '@/generated/prisma/client'
import type { RoleKey } from './constants'
import { initialsOf } from './format'

/**
 * The signed-in user.
 *
 * Two ways in, and the difference between them is recorded on the result
 * rather than assumed:
 *
 *  - A **real Auth.js session**, backed by a credential the person actually
 *    holds. `authenticated` is true.
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
  name: string
  role: Role
  roleKey: RoleKey
  /** Set for external promoters — scopes every event query to their org. */
  promoter: string | null
  external: boolean
  /** The person record behind the account, when there is one. */
  personId: string | null
  initials: string
  /** Whether a real credential backs this request. False for the dev stub. */
  authenticated: boolean
}

export const roleKeyOf = (role: Role): RoleKey => role.toLowerCase() as RoleKey

/** The dev role picker is only ever available outside production. */
export const stubAllowed = process.env.NODE_ENV !== 'production'

/** Whether real sign-in is available on this install. */
export { authConfigured }

const USER_INCLUDE = { person: true } as const

type Row = NonNullable<Awaited<ReturnType<typeof db.user.findFirst>>> & {
  person?: { name: string; initials: string } | null
}

function shape(u: Row, authenticated: boolean): SessionUser {
  return {
    id: u.id,
    name: u.name ?? u.person?.name ?? u.email,
    role: u.role,
    roleKey: roleKeyOf(u.role),
    promoter: u.promoter,
    external: u.role === 'PROMOTER',
    personId: u.personId,
    initials: u.person?.initials ?? initialsOf(u.name ?? u.email),
    authenticated,
  }
}

export async function currentUser(): Promise<SessionUser | null> {
  // A real session wins wherever there is one.
  if (authConfigured) {
    const session = await auth()
    const id = session?.user?.id

    if (id) {
      const u = await db.user.findFirst({ where: { id, active: true }, include: USER_INCLUDE })
      if (u) return shape(u, true)

      // A live session whose account has since been switched off. Falling
      // through to the stub here would quietly re-admit them, so stop.
      return null
    }
  }

  if (!stubAllowed) return null

  const jar = await cookies()
  const id = jar.get(SESSION_COOKIE)?.value
  if (!id) return null

  const u = await db.user.findFirst({ where: { id, active: true }, include: USER_INCLUDE })
  if (!u) return null

  return shape(u, false)
}
