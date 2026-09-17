import 'server-only'
import { db } from './db'
import { ROLE_LABEL, MODULES, type RoleKey } from './constants'
import { roleKeyOf } from './session'
import { modulesOpenByRole } from './scope'
import { ago, initialsOf } from './format'
import { sessionState } from './auth-rules'
import { userProblems } from './auth-rules'
import type { Role } from '@/generated/prisma/client'

/**
 * Loads Admin.
 *
 * Admin is where accounts come from. There is no sign-up in this product —
 * see the note on `createUser` in auth.ts — so every person who can reach any
 * of this was added on this page by somebody.
 */

export interface AdminUser {
  id: string
  email: string
  name: string
  role: Role
  roleLabel: string
  modules: string
  /** The organisation an external account acts for, and what scopes it. */
  organisationId: string | null
  organisationName: string | null
  /** External people only. Staff are named through their Person record. */
  firstName: string | null
  lastName: string | null
  phone: string | null
  active: boolean
  personId: string | null
  personName: string | null
  initials: string
  /** Ways this account is set up wrongly. Not errors, but worth saying. */
  problems: string[]
  /** "3 days ago", or null if they have never signed in with a real credential. */
  lastSignIn: string | null
  /** Whether a password is set. Never the password, or anything derived from it. */
  hasPassword: boolean
  liveSessions: number
}

export interface PersonOption {
  id: string
  name: string
  initials: string
  /** True when another account already claims them. */
  taken: boolean
}

export interface AdminLoad {
  users: AdminUser[]
  people: PersonOption[]
  roles: { value: Role; label: string }[]
  activeAdmins: number
  /** Every promoter organisation, for the picker. */
  organisations: { id: string; name: string }[]
}

export async function loadAdmin(): Promise<AdminLoad> {
  const now = new Date()
  const rows = await db.user.findMany({
    orderBy: [{ active: 'desc' }, { role: 'asc' }, { email: 'asc' }],
    include: {
      person: { select: { id: true, name: true, initials: true } },
      organisation: { select: { id: true, name: true } },
      sessions: {
        where: { expires: { gt: now } },
        select: { expires: true, lastSeenAt: true },
      },
    },
  })

  // What each account can actually open, which for an outside account is less
  // than its role's rows say.
  const byRole = modulesOpenByRole(await db.modulePermission.findMany())

  const users: AdminUser[] = rows.map((u) => {
    const mods = byRole.get(u.role) ?? []
    return {
      id: u.id,
      email: u.email,
      name: u.name ?? u.person?.name ?? u.email,
      role: u.role,
      roleLabel: ROLE_LABEL[roleKeyOf(u.role) as RoleKey] ?? u.role,
      modules: MODULES.filter((m) => mods.includes(m.key))
        .map((m) => m.label)
        .join(' · '),
      organisationId: u.organisationId,
      organisationName: u.organisation?.name ?? null,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      active: u.active,
      personId: u.personId,
      personName: u.person?.name ?? null,
      initials: u.person?.initials ?? initialsOf(u.name ?? u.email),
      problems: userProblems({
        role: u.role,
        organisationId: u.organisationId,
        personId: u.personId,
      }),
      lastSignIn: u.lastSignInAt ? ago(u.lastSignInAt, now) : null,
      hasPassword: u.passwordHash !== null,
      // Past its idle limit a session is dead even before its row is cleared.
      liveSessions: u.sessions.filter((x) => sessionState(x, now) === 'live').length,
    }
  })

  const claimed = new Set(rows.map((u) => u.personId).filter(Boolean) as string[])
  const people = (
    await db.person.findMany({
      where: { active: true },
      select: { id: true, name: true, initials: true },
      orderBy: { name: 'asc' },
    })
  ).map((p) => ({ ...p, taken: claimed.has(p.id) }))

  // Every organisation on the books, not only those already carrying an
  // account — a coordinator links a new promoter to an existing label, which
  // means the label has to be offerable before anybody belongs to it.
  const organisations = await db.payee.findMany({
    where: { kind: 'PROMOTER' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  return {
    users,
    people,
    roles: (Object.keys(ROLE_LABEL) as RoleKey[]).map((k) => ({
      value: k.toUpperCase() as Role,
      label: ROLE_LABEL[k],
    })),
    activeAdmins: rows.filter((u) => u.active && u.role === 'ADMIN').length,
    organisations,
  }
}
