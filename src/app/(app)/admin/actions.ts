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
  // For an external account this is an organisation *id* from the picker, not
  // a typed name — see `setOrganisation` below for why.
  const organisationId = String(form.get('organisationId') ?? '').trim() || null
  const firstName = String(form.get('firstName') ?? '').trim() || null
  const lastName = String(form.get('lastName') ?? '').trim() || null
  const phone = String(form.get('phone') ?? '').trim() || null

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
      name: name || [firstName, lastName].filter(Boolean).join(' ') || null,
      role,
      personId,
      ...(role === 'PROMOTER'
        ? { organisationId, firstName, lastName, phone }
        : { organisationId: null }),
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
    data: { role, ...(role === 'PROMOTER' ? {} : { organisationId: null }) },
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

/**
 * Put an external account into an organisation.
 *
 * Takes an organisation *id*, never a typed name. That is the whole point of
 * this change: the organisation is a record, several people can share it, and
 * what a promoter may read is decided by matching that id against
 * `Event.promoterId` rather than by matching text against text.
 *
 * Linking more than one promoter to one label is exactly this action, run
 * twice. It is deliberately manual — the venue does it rarely, and a
 * heuristic that guessed which label somebody belonged to would be a
 * heuristic deciding who reads whose settlements.
 */
export async function setOrganisation(userId: string, organisationId: string): Promise<Said> {
  const { user } = await requireModule('admin')

  // Coordinators as well as admins, per the venue's own ask. Still not the
  // promoters themselves: an external user moving their own account into
  // another organisation would be choosing what they can read.
  if (user.role !== 'ADMIN' && user.role !== 'COORDINATOR') {
    return said('Only a coordinator or an administrator can do that.', 'stop')
  }
  if (user.external) return said('Not something an external account can do.', 'stop')

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, email: true },
  })
  if (!target) return said('No such account.', 'stop')
  if (target.role !== 'PROMOTER') {
    return said('Only an external coordinator carries an organisation.', 'stop')
  }

  const id = organisationId.trim() || null

  // The id has to name a real promoter organisation. Without this the account
  // would be scoped to something that matches no event, which looks identical
  // to a permissions bug from the outside.
  let name: string | null = null
  if (id) {
    const org = await db.payee.findFirst({
      where: { id, kind: 'PROMOTER' },
      select: { name: true },
    })
    if (!org) return said('That is not an organisation on the books.', 'stop')
    name = org.name
  }

  await db.user.update({ where: { id: userId }, data: { organisationId: id } })

  refresh()
  return said(
    name
      ? `${target.email} now sees ${name}'s events, and nothing else.`
      : 'Organisation cleared — they will see no events at all until one is set.',
    name ? 'good' : 'warn',
  )
}

/** Name and phone for somebody outside the venue. */
export async function setExternalDetails(
  userId: string,
  form: { firstName: string; lastName: string; phone: string },
): Promise<Said> {
  const { user } = await requireModule('admin')
  if (user.external) return said('Not something an external account can do.', 'stop')

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, email: true },
  })
  if (!target) return said('No such account.', 'stop')
  if (target.role !== 'PROMOTER') {
    return said('Staff are named through their person record, not here.', 'stop')
  }

  const firstName = form.firstName.trim() || null
  const lastName = form.lastName.trim() || null
  const phone = form.phone.trim() || null

  await db.user.update({
    where: { id: userId },
    data: {
      firstName,
      lastName,
      phone,
      // `name` stays the one line the rest of the product shows, so it is kept
      // in step rather than becoming a third spelling of the same person.
      name: [firstName, lastName].filter(Boolean).join(' ') || target.email,
    },
  })

  refresh()
  return said('Saved. This is the name and number the venue contacts them on.')
}
