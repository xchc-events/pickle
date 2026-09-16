'use server'

import { refresh } from 'next/cache'
import { after } from 'next/server'
import { requireUser } from '@/lib/permissions'
import {
  credentialsOf,
  endSession,
  endSessions,
  passwordHistory,
  recordAuthEvent,
  replacePassword,
} from '@/lib/auth-data'
import { emailLink, notifyPasswordChanged } from '@/lib/auth-links'
import { mayAttemptPassword } from '@/lib/auth-rules'
import { hashPassword, verifyPassword } from '@/lib/password'
import { PASSWORD_MAX, checkPassword } from '@/lib/password-policy'
import { said, type Said } from '@/lib/toast'

/**
 * A person's own password and sessions.
 *
 * Not a module, so not gated by one: every account manages its own. Each
 * action re-reads who is asking and touches only that account — nothing here
 * takes a user id from the browser.
 */

export type ChangeState = { error?: string; done?: string } | null

const NO_SESSION =
  'You are signed in through the development role picker, which has no password or sessions of its own. Sign in for real to change these.'

export async function changePassword(_: ChangeState, form: FormData): Promise<ChangeState> {
  const user = await requireUser()
  if (!user.sessionId) return { error: NO_SESSION }

  const current = String(form.get('current') ?? '')
  const next = String(form.get('password') ?? '')
  const confirm = String(form.get('confirm') ?? '')

  const account = await credentialsOf(user.id)
  if (!account?.passwordHash) {
    return {
      error: 'There is no password on this account yet. Get a link by email below to set one.',
    }
  }

  // The cheap refusals first, so a typo in the new password does not spend
  // one of the attempts the throttle allows at the old one.
  if (next !== confirm) return { error: 'The two new passwords do not match. Type it again.' }

  const verdict = checkPassword(next, {
    email: account.email,
    names: [account.name, account.firstName, account.lastName],
  })
  if (!verdict.ok) return { error: verdict.why }

  // The same throttle as the sign-in form, counted against the same address.
  // Otherwise a session left open somewhere would be a way to guess the
  // password at full speed.
  const throttle = mayAttemptPassword(await passwordHistory(account.email), new Date())
  if (!throttle.ok) return { error: throttle.why }

  const right =
    current.length <= PASSWORD_MAX * 4 && (await verifyPassword(current, account.passwordHash))
  if (!right) {
    await recordAuthEvent('PASSWORD_FAILED', { email: account.email, userId: account.id })
    return { error: 'Your current password is not right, so nothing has changed.' }
  }

  const when = new Date()
  await replacePassword(account.id, await hashPassword(next), user.sessionId, when)
  await recordAuthEvent('PASSWORD_CHANGED', { email: account.email, userId: account.id })
  after(() => notifyPasswordChanged(account.email, when))

  refresh()
  return { done: 'Password changed. You are still signed in here, and signed out everywhere else.' }
}

/**
 * Email a link that sets a password — to the address on the account, never
 * one typed into a form. For somebody who has no password yet, or would
 * rather reset than remember the old one.
 */
export async function emailMePasswordLink(): Promise<Said> {
  const user = await requireUser()
  if (!user.sessionId) return said(NO_SESSION, 'stop')

  const account = await credentialsOf(user.id)
  if (!account) return said('No such account.', 'stop')

  switch (await emailLink(account, 'RESET')) {
    case 'sent':
      return said(
        `A link is on its way to ${account.email}. It works once and stops working in an hour.`,
      )
    case 'logged':
      return said(
        'Email is not set up on this install, so the link was written to the server log instead.',
        'warn',
      )
    case 'cooling':
      return said(
        `A link went to ${account.email} less than a minute ago. Check the inbox.`,
        'warn',
      )
    case 'unavailable':
      return said('Links cannot be sent from this install until AUTH_URL is set.', 'stop')
    case 'unconfigured':
      return said(
        'Email is not configured on this install, so no link can be sent. Ask an administrator.',
        'stop',
      )
  }
}

export async function signOutEverywhereElse(): Promise<Said> {
  const user = await requireUser()
  if (!user.sessionId) return said(NO_SESSION, 'stop')

  const ended = await endSessions(user.id, { except: user.sessionId })
  if (ended > 0) await recordAuthEvent('SESSIONS_ENDED', { email: user.email, userId: user.id })

  refresh()
  return ended > 0
    ? said(
        `Signed out of ${ended} other ${ended === 1 ? 'session' : 'sessions'}. This one stays signed in.`,
      )
    : said('There were no other sessions to end.', 'warn')
}

export async function endOtherSession(sessionId: string): Promise<Said> {
  const user = await requireUser()
  if (!user.sessionId) return said(NO_SESSION, 'stop')

  if (sessionId === user.sessionId) {
    return said('That is the session you are using now. Use Sign out to end it.', 'warn')
  }

  const ended = await endSession(user.id, sessionId)
  if (ended) await recordAuthEvent('SESSIONS_ENDED', { email: user.email, userId: user.id })

  refresh()
  return ended
    ? said('Signed out. Whoever was using that session will have to sign in again.')
    : said('That session had already ended.', 'warn')
}
