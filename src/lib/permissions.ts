import 'server-only'
import { notFound } from 'next/navigation'
import { redirect } from 'next/navigation'
import { db } from './db'
import type { ModuleKey } from './constants'
import { currentUser, type SessionUser } from './session'

/**
 * Server-side access control.
 *
 * Hiding a module from the sidebar is a convenience. This file is the control:
 * every page and every server function calls through it, so a module a role
 * cannot see is also unreachable by URL and by direct POST.
 */

/** Modules this role may see, read from the database, not from a constant. */
export async function modulesFor(user: SessionUser): Promise<ModuleKey[]> {
  const rows = await db.modulePermission.findMany({
    where: { role: user.role },
    select: { module: true },
  })
  return rows.map((r) => r.module as ModuleKey)
}

export async function canSee(user: SessionUser, moduleKey: ModuleKey): Promise<boolean> {
  const mods = await modulesFor(user)
  return mods.includes(moduleKey)
}

/**
 * Gate a page or a server function on a module.
 *
 * Denial is a 404, not a 403: whether a module exists is itself something an
 * external promoter has no business learning.
 */
export async function requireModule(
  moduleKey: ModuleKey,
): Promise<{ user: SessionUser; modules: ModuleKey[] }> {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const modules = await modulesFor(user)
  if (!modules.includes(moduleKey)) notFound()

  return { user, modules }
}

export { eventScope, type ScopedUser } from './scope'
