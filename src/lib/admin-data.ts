import 'server-only'
import { db } from './db'
import { ROLE_LABEL, MODULES, type ModuleKey, type RoleKey } from './constants'
import { roleKeyOf } from './session'
import { initialsOf } from './format'
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
  /** Whether they have ever actually signed in with a real credential. */
  everSignedIn: boolean
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
  const rows = await db.user.findMany({
    orderBy: [{ active: 'desc' }, { role: 'asc' }, { email: 'asc' }],
    include: {
      person: { select: { id: true, name: true, initials: true } },
      organisation: { select: { id: true, name: true } },
      accounts: { select: { provider: true } },
      sessions: { where: { expires: { gt: new Date() } }, select: { sessionToken: true } },
    },
  })

  const perms = await db.modulePermission.findMany()
  const byRole = new Map<string, ModuleKey[]>()
  for (const p of perms) {
    const list = byRole.get(p.role) ?? []
    list.push(p.module as ModuleKey)
    byRole.set(p.role, list)
  }

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
      everSignedIn: u.accounts.length > 0 || u.emailVerified !== null,
      liveSessions: u.sessions.length,
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
