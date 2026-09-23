'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { requireModule } from '@/lib/permissions'
import { endSessions, recordAuthEvent } from '@/lib/auth-data'
import { emailLink, type LinkOutcome } from '@/lib/auth-links'
import { mayChangeRole, maySetActive, normaliseEmail } from '@/lib/auth-rules'
import { payRate } from '@/lib/finance'
import { money } from '@/lib/format'
import { said, type Said } from '@/lib/toast'
import type { Employment, Role } from '@/generated/prisma/client'

/**
 * Admin's mutations — who has access to this product.
 *
 * Every one of them re-checks the module for itself, like every other action
 * in the app. Three things are specific to this file:
 *
 *  - **Deactivating ends their sessions, and their unused links.** Setting
 *    `active: false` stops the next sign-in, but somebody already signed in
 *    would keep working until their session expired. For a venue, "they left
 *    on Friday" has to mean they are out on Friday, so the session rows go
 *    too. This is the reason sessions are database rows rather than JWTs —
 *    see src/lib/auth.ts.
 *  - **The last administrator cannot be removed or demoted.** Neither is
 *    recoverable from inside the product, so both are refused rather than
 *    warned about. See `maySetActive` and `mayChangeRole` in auth-rules.ts.
 *  - **Administrators never see or set anybody's password.** They send an
 *    invitation, and the person chooses their own.
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

  const created = await db.user.create({
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
  const who = name || email

  if (form.get('invite') !== 'on') {
    return said(
      `${who} has an account. Nothing was emailed — send an invitation from their row when they are ready, or they can ask for a link from the sign-in page.`,
    )
  }

  // The account exists either way, so a failed invitation is a warning here
  // rather than a stop: there is something to retry from, not something lost.
  const sent = await invite(created, user.id)
  return said(`${who} has an account. ${sent.text}`, sent.kind === 'good' ? 'good' : 'warn')
}

/** What Admin says after trying to email an invitation. */
function sayInvite(outcome: LinkOutcome, email: string): Said {
  switch (outcome) {
    case 'sent':
      return said(`An invitation to choose a password is on its way to ${email}. It lasts 7 days.`)
    case 'logged':
      return said(
        'Email is not set up on this install, so the invitation was written to the server log instead.',
        'warn',
      )
    case 'cooling':
      return said(`An email went to ${email} less than a minute ago. Give it a moment.`, 'warn')
    case 'unavailable':
      return said('Invitations cannot be sent from this install until AUTH_URL is set.', 'stop')
    case 'unconfigured':
      return said(
        'Email is not configured on this install, so the invitation was not sent. Set AUTH_RESEND_KEY and EMAIL_FROM.',
        'stop',
      )
  }
}

async function invite(
  account: { id: string; email: string; name: string | null },
  actorId: string,
): Promise<Said> {
  try {
    return sayInvite(await emailLink(account, 'INVITE', actorId), account.email)
  } catch (err) {
    console.error('Sending an invitation failed:', err)
    return said(
      'The invitation was not sent — the mail service refused it. The server log has its reason.',
      'stop',
    )
  }
}

/**
 * Email somebody a week-long link to choose their first password.
 *
 * Only to an account with no password. Somebody who has one resets it
 * themselves from the sign-in page, which proves they hold the inbox; an
 * administrator mailing out password links for accounts that already have
 * passwords would be a quiet way to take one over.
 */
export async function sendInvite(userId: string): Promise<Said> {
  const { user } = await requireModule('admin')
  if (user.role !== 'ADMIN') return said('Only an administrator can send invitations.', 'stop')

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, active: true, passwordHash: true },
  })
  if (!target) return said('No such account.', 'stop')

  if (!target.active) {
    return said(
      'That account is switched off, so the link would not work. Turn it on first.',
      'stop',
    )
  }
  if (target.passwordHash) {
    return said(
      `${target.name ?? target.email} already has a password. If they have forgotten it, they can set a new one from the sign-in page.`,
      'warn',
    )
  }

  const result = await invite(target, user.id)
  refresh()
  return result
}

/**
 * Sign somebody out everywhere, without switching them off.
 *
 * For a lost phone or a laptop left signed in at the bar. They can sign
 * straight back in with their password; to stop that, switch the account off.
 */
export async function endSessionsFor(userId: string): Promise<Said> {
  const { user } = await requireModule('admin')
  if (user.role !== 'ADMIN') return said('Only an administrator can do that.', 'stop')

  if (userId === user.id) {
    return said('To sign yourself out of other browsers, use your account page.', 'warn')
  }

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  })
  if (!target) return said('No such account.', 'stop')

  const ended = await endSessions(target.id)
  await recordAuthEvent('SESSIONS_ENDED', {
    email: target.email,
    userId: target.id,
    actorId: user.id,
  })

  refresh()
  const who = target.name ?? target.email
  return ended > 0
    ? said(
        `${who} is signed out everywhere — ${ended} ${ended === 1 ? 'session' : 'sessions'} ended. They can sign back in; switch the account off to stop that.`,
      )
    : said(`${who} had no open sessions.`, 'warn')
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

/**
 * Set a person's pay rate: employee or contractor.
 *
 * Set on the `Person`, not the `User` — the same record the roster and
 * Hours already read, so a change here is the one place it has to happen.
 * Administrator-only, like every other change of what somebody is paid.
 */
export async function setEmployment(userId: string, employment: Employment): Promise<Said> {
  const { user } = await requireModule('admin')
  if (user.role !== 'ADMIN') return said('Only an administrator can set pay rates.', 'stop')

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, personId: true, name: true, email: true },
  })
  if (!target) return said('No such account.', 'stop')
  if (target.role === 'PROMOTER') {
    return said('An external promoter is not paid through the roster.', 'stop')
  }
  if (!target.personId) {
    return said(
      'Link this account to a person first — pay rate is set on the person record.',
      'stop',
    )
  }

  await db.person.update({ where: { id: target.personId }, data: { employment } })

  refresh()
  const who = target.name ?? target.email
  const noun = employment === 'EMPLOYEE' ? 'an employee' : 'a contractor'
  return said(`${who} is now paid as ${noun} — ${money(payRate(employment))}/hr.`)
}

export async function setActive(userId: string, active: boolean): Promise<Said> {
  const { user } = await requireModule('admin')

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, active: true, name: true, email: true },
  })
  if (!target) return said('No such account.', 'stop')

  // Asked whichever way the switch is going: switching somebody back on is
  // an administrator's call as much as switching them off.
  const verdict = maySetActive(user, target, active, await activeAdmins())
  if (!verdict.ok) return said(verdict.why, 'stop')

  const who = target.name ?? target.email

  if (active) {
    await db.user.update({ where: { id: userId }, data: { active: true } })
    refresh()
    return said(`${who} can sign in again.`)
  }

  // Their sessions go with the switch. Without this they would keep working
  // until the session expired, which is not what "switched off" means. So do
  // links they have not used yet: spending one checks the account is on, but
  // a pending invitation has no business outliving the account it was for.
  const [, ended] = await db.$transaction([
    db.user.update({ where: { id: userId }, data: { active: false } }),
    db.session.deleteMany({ where: { userId } }),
    db.authToken.deleteMany({ where: { userId, usedAt: null } }),
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

/**
 * A staff account's phone number.
 *
 * `firstName`/`lastName` are not set here — a staff member is named through
 * their Person record (see `setExternalDetails` below, and "Your people" in
 * Admin) — but `phone` lives on `User` regardless of role, and staff never
 * had anywhere to set theirs. "We need contact information on these
 * sections, because if you need to call this person we want your phone
 * number and email. That way external organisers can easily access it."
 * (Connor, 23 Sep 2026.) The email half is the account's own sign-in
 * address, already shown on the row; only the phone needed a place to go.
 */
export async function setPhone(userId: string, phone: string): Promise<Said> {
  const { user } = await requireModule('admin')
  if (user.external) return said('Not something an external account can do.', 'stop')

  const target = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, name: true, email: true },
  })
  if (!target) return said('No such account.', 'stop')
  if (target.role === 'PROMOTER') {
    return said(
      'An external coordinator’s phone is set with their other details, not here.',
      'stop',
    )
  }

  await db.user.update({ where: { id: userId }, data: { phone: phone.trim() || null } })

  refresh()
  return said(`Saved. This is the number the venue contacts ${target.name ?? target.email} on.`)
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

/**
 * Rewrite one venue spec component's title and body.
 *
 * Connor, 23 Sep 2026: "It'd be better to have a more full-featured option
 * where you can select which components of a venue spec sheet you're
 * sending out." The set itself is seeded; this is where its wording is
 * kept current. `key` and `order` are not editable here — reordering the
 * seeded set is not something this round asked for.
 */
export async function updateVenueSpecComponent(
  id: string,
  title: string,
  body: string,
): Promise<Said> {
  const { user } = await requireModule('admin')
  if (user.role !== 'ADMIN') return said('Only an administrator can edit the venue spec.', 'stop')

  const trimmedTitle = title.trim()
  if (!trimmedTitle) return said('Give it a title.', 'stop')

  const row = await db.venueSpecComponent.findUnique({ where: { id }, select: { id: true } })
  if (!row) return said('No such component.', 'stop')

  await db.venueSpecComponent.update({
    where: { id },
    data: { title: trimmedTitle, body },
  })

  refresh()
  return said('Saved. Tech reads this section however it is worded here.')
}

/** Take a component out of what Tech offers to send, or put it back. */
export async function setVenueSpecComponentActive(id: string, active: boolean): Promise<Said> {
  const { user } = await requireModule('admin')
  if (user.role !== 'ADMIN') return said('Only an administrator can edit the venue spec.', 'stop')

  const row = await db.venueSpecComponent.findUnique({ where: { id }, select: { id: true } })
  if (!row) return said('No such component.', 'stop')

  await db.venueSpecComponent.update({ where: { id }, data: { active } })

  refresh()
  return said(
    active ? 'Back on — Tech can tick it again.' : 'Off — Tech will not offer it to send.',
  )
}
