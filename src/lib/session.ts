import 'server-only'
import { cookies } from 'next/headers'
import { db } from './db'
import type { Role } from '@/generated/prisma/client'
import type { RoleKey } from './constants'
import { initialsOf } from './format'

/**
 * The signed-in user.
 *
 * THIS IS NOT AUTHENTICATION YET. It is the prototype's role picker made
 * server-side: a cookie carries a user id, and every permission decision is
 * taken on the server from the row that id resolves to. There is no
 * credential, so anyone who can set the cookie can be anyone.
 *
 * What it does establish — and what has to survive the real thing landing —
 * is that the *server* decides what a user can see. Auth.js is already a
 * dependency and the User/Account/Session models are already in the schema;
 * replacing `currentUser()` with a real session lookup is the whole change.
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
}

export const roleKeyOf = (role: Role): RoleKey => role.toLowerCase() as RoleKey

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies()
  const id = jar.get(SESSION_COOKIE)?.value
  if (!id) return null

  const u = await db.user.findFirst({
    where: { id, active: true },
    include: { person: true },
  })
  if (!u) return null

  return {
    id: u.id,
    name: u.name ?? u.person?.name ?? u.email,
    role: u.role,
    roleKey: roleKeyOf(u.role),
    promoter: u.promoter,
    external: u.role === 'PROMOTER',
    personId: u.personId,
    initials: u.person?.initials ?? initialsOf(u.name ?? u.email),
  }
}
