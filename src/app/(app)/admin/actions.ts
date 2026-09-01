'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { requireModule } from '@/lib/permissions'
import { mayChangeRole, mayDeactivate, normaliseEmail } from '@/lib/auth-rules'
import { said, type Said } from '@/lib/toast'
import type { Role } from '@/generated/prisma/client'

/**
 * Admin's mutations — who has access to this product.
 *
 * Every one of them re-checks the module for itself, like every other action
 * in the app. Two things are specific to this file:
 *
 *  - **Deactivating ends their sessions.** Setting `active: false` stops the
 *    next sign-in, but somebody already signed in would keep working until
 *    their session expired. For a venue, "they left on Friday" has to mean
 *    they are out on Friday, so the session rows go too. This is the reason
 *    auth.ts uses database sessions rather than JWTs — a JWT cannot be taken
 *    back.
 *  - **The last administrator cannot be removed or demoted.** Neither is
 *    recoverable from inside the product, so both are refused rather than
 *    warned about. See `mayDeactivate` and `mayChangeRole` in auth-rules.ts.
 */

/** The count the last-admin guard is measured against. */
async function activeAdmins(): Promise<number> {
  return db.user.count({ where: { active: true, role: 'ADMIN' } })
}

export async function addUser(form: FormData): Promise<Said> {
  const { user } = await requireModule('admin')
  if (user.role !== 'ADMIN') return said('Only an administrator can add people.', 'stop')

  const email = normaliseEmail(String(form.get('email') ?? ''))
  const name = String(form.get('name') ?? '').trim()
  const role = String(form.get('role') ?? 'COORDINATOR') as Role
  const personId = String(form.get('personId') ?? '') || null
  const promoter = String(form.get('promoter') ?? '').trim() || null

  if (!email.includes('@')) return said('That is not an email address.', 'stop')

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, active: true },
  })
  if (existing) {
    return said(
      existing.active
        ? 'Somebody already has that address.'
        : 'That address already has an account — it is switched off. Turn it back on rather than making a second one.',
      'warn',
    )
  }

  // A person can only back one account: two accounts pointing at one person
  // would put the same hours under two names.
  if (personId) {
    const taken = await db.user.findFirst({ where: { personId }, select: { id: true } })
    if (taken) return said('That person already has an account.', 'stop')
  }

  await db.user.create({
    data: {
      email,
      name: name || null,
      role,
      personId,
      promoter: role === 'PROMOTER' ? promoter : null,
      active: true,
    },
  })

  refresh()
  return said(
    `${name || email} can sign in now. Nothing was emailed — send them the address of this site and they sign in with ${role === 'PROMOTER' ? 'a link to that address' : 'their XCHC Google account'}.`,
  )
}

export async function setRole(userId: string, role: Role): Promise<Said> {
  const { user } = await requireModule('admin')

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, active: true, name: true, email: true },
  })
  if (!target) return said('No such account.', 'stop')

  const verdict = mayChangeRole(user, target, role, await activeAdmins())
  if (!verdict.ok) return said(verdict.why, 'stop')

  await db.user.update({
    where: { id: userId },
    // Only a promoter carries an organisation. Moving somebody inside the
    // venue clears it rather than leaving a stale scope on the account.
    data: { role, ...(role === 'PROMOTER' ? {} : { promoter: null }) },
  })

  refresh()
  return said(
    `${target.name ?? target.email} is now ${role.toLowerCase()}. What they can see changed with it — the sidebar and every URL.`,
  )
}

export async function setActive(userId: string, active: boolean): Promise<Said> {
  const { user } = await requireModule('admin')

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, active: true, name: true, email: true },
  })
  if (!target) return said('No such account.', 'stop')

  // The guard only has anything to say about switching somebody off.
  if (!active) {
    const verdict = mayDeactivate(user, target, await activeAdmins())
    if (!verdict.ok) return said(verdict.why, 'stop')
  }

  const who = target.name ?? target.email

  if (active) {
    await db.user.update({ where: { id: userId }, data: { active: true } })
    refresh()
    return said(`${who} can sign in again.`)
  }

  // Their sessions go with the switch. Without this they would keep working
  // until the session expired, which is not what "switched off" means.
  const [, ended] = await db.$transaction([
    db.user.update({ where: { id: userId }, data: { active: false } }),
    db.session.deleteMany({ where: { userId } }),
  ])

  refresh()
  return said(
    ended.count > 0
      ? `${who} is switched off, and the ${ended.count === 1 ? 'session they had open was' : `${ended.count} sessions they had open were`} ended. They are out now, not at the end of the day.`
      : `${who} is switched off.`,
    'warn',
  )
}

export async function linkPerson(userId: string, personId: string): Promise<Said> {
  const { user } = await requireModule('admin')
  if (user.role !== 'ADMIN') return said('Only an administrator can do that.', 'stop')

  if (!personId) {
    await db.user.update({ where: { id: userId }, data: { personId: null } })
    refresh()
    return said('Unlinked. They can sign in, but they cannot be rostered.', 'warn')
  }

  const taken = await db.user.findFirst({
    where: { personId, id: { not: userId } },
    select: { email: true },
  })
  if (taken) return said(`${taken.email} is already that person.`, 'stop')

  const person = await db.person.findUnique({
    where: { id: personId },
    select: { name: true },
  })
  if (!person) return said('No such person.', 'stop')

  await db.user.update({ where: { id: userId }, data: { personId } })

  refresh()
  return said(
    `Linked to ${person.name}. Their shifts and hours now belong to this account — one record of a person, one record of an hour.`,
  )
}

export async function setPromoter(userId: string, promoter: string): Promise<Said> {
  const { user } = await requireModule('admin')
  if (user.role !== 'ADMIN') return said('Only an administrator can do that.', 'stop')

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, email: true },
  })
  if (!target) return said('No such account.', 'stop')
  if (target.role !== 'PROMOTER') {
    return said('Only an external coordinator carries an organisation.', 'stop')
  }

  const org = promoter.trim() || null
  await db.user.update({ where: { id: userId }, data: { promoter: org } })

  refresh()
  return said(
    org
      ? `${target.email} now sees ${org}'s events, and nothing else.`
      : 'Organisation cleared — they will see no events at all until one is set.',
    org ? 'good' : 'warn',
  )
}
