'use server'

import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { startSession } from '@/lib/auth'
import {
  previewLink,
  recordAuthEvent,
  redeemSignInLink,
  setPasswordWithLink,
} from '@/lib/auth-data'
import { notifyPasswordChanged } from '@/lib/auth-links'
import { hashPassword } from '@/lib/password'
import { checkPassword } from '@/lib/password-policy'

/**
 * What an emailed link does once the person presses the button on the page it
 * opened. Opening the page spends nothing — see page.tsx.
 */

export type LinkActionState = { error?: string } | null

const DEAD =
  'That link has already been used, or it has expired. Ask for a new one from the sign-in page.'

export async function continueWithLink(
  _: LinkActionState,
  form: FormData,
): Promise<LinkActionState> {
  const spent = await redeemSignInLink(String(form.get('token') ?? ''))
  if (!spent) return { error: DEAD }

  await recordAuthEvent('LINK_SIGN_IN', { email: spent.email, userId: spent.userId })
  await startSession(spent.userId, 'EMAIL_LINK')
  redirect('/')
}

/**
 * Set a password from an invitation or a reset link.
 *
 * Everything that can refuse — the link's state, the two boxes disagreeing,
 * the password policy — refuses before the link is spent, so a person whose
 * first choice of password is turned down can simply choose another.
 */
export async function setPasswordFromLink(
  _: LinkActionState,
  form: FormData,
): Promise<LinkActionState> {
  const token = String(form.get('token') ?? '')
  const password = String(form.get('password') ?? '')
  const confirm = String(form.get('confirm') ?? '')

  const link = await previewLink(token)
  if (!link || link.state !== 'open') return { error: DEAD }
  if (link.purpose === 'SIGN_IN') {
    return { error: 'That link signs you in; it cannot set a password. Ask for a password link.' }
  }

  if (password !== confirm) return { error: 'The two passwords do not match. Type it again.' }

  const verdict = checkPassword(password, { email: link.email, names: link.names })
  if (!verdict.ok) return { error: verdict.why }

  const set = await setPasswordWithLink(token, await hashPassword(password))
  if (!set) return { error: DEAD }

  const when = new Date()
  await recordAuthEvent(set.purpose === 'INVITE' ? 'PASSWORD_SET' : 'PASSWORD_RESET', {
    email: set.email,
    userId: set.userId,
  })
  // A password that replaced another is worth telling the owner about — it is
  // how they find out if it was not them.
  if (link.hasPassword) after(() => notifyPasswordChanged(set.email, when))

  await startSession(set.userId, 'EMAIL_LINK')
  redirect('/')
}
