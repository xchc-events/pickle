'use server'

import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { startSession } from '@/lib/auth'
import { attemptPassword } from '@/lib/auth-data'
import { emailLinkQuietly } from '@/lib/auth-links'
import { normaliseEmail } from '@/lib/auth-rules'

/**
 * The sign-in page's forms.
 *
 * Each returns state for `useActionState` rather than redirecting with a
 * query string, so a failed attempt keeps the address in the box and the
 * message beside the form — and nothing about the attempt lands in a URL, a
 * history entry or a proxy log.
 *
 * Where a successful sign-in lands is not decided here. Sending everybody to
 * `/pipeline` would 404 the promoters, who do not have it, so it goes to `/`
 * and the index puts each person where their permissions actually reach.
 */

export type SignInState = { error?: string; email?: string } | null
export type LinkState = { error?: string; sentTo?: string } | null

const WRONG =
  'That email address and password do not match. If you have never set a password, or have forgotten it, get a link by email below.'

const SWITCHED_OFF =
  'That account has been switched off. If that is wrong, ask an administrator at the venue.'

export async function signInWithPassword(_: SignInState, form: FormData): Promise<SignInState> {
  const email = normaliseEmail(String(form.get('email') ?? ''))
  // Never trimmed or normalised here: a space somebody typed is part of their
  // password, and the hashing normalises Unicode itself.
  const password = String(form.get('password') ?? '')

  if (!email) return { error: 'Enter your email address.', email }
  if (!password) return { error: 'Enter your password.', email }

  const result = await attemptPassword(email, password)

  if (!result.ok) {
    if (result.reason === 'throttled') return { error: result.verdict.why, email }
    if (result.reason === 'inactive') return { error: SWITCHED_OFF, email }
    return { error: WRONG, email }
  }

  await startSession(result.userId, 'PASSWORD')
  redirect('/')
}

/**
 * The two "email me a link" forms — to sign in, and to set a password.
 *
 * Both answer every well-formed address identically and immediately, and do
 * the real work after the response. An address with an account, one without,
 * a switched-off one and one that had a link a moment ago all look the same
 * from the outside, in what the page says and in how long it took to say it.
 */
async function requestLink(form: FormData, purpose: 'SIGN_IN' | 'RESET'): Promise<LinkState> {
  const email = normaliseEmail(String(form.get('email') ?? ''))
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    return { error: 'Enter the email address the venue has for you.' }
  }

  after(() => emailLinkQuietly(email, purpose))
  return { sentTo: email }
}

export async function requestSignInLink(_: LinkState, form: FormData): Promise<LinkState> {
  return requestLink(form, 'SIGN_IN')
}

export async function requestPasswordLink(_: LinkState, form: FormData): Promise<LinkState> {
  return requestLink(form, 'RESET')
}
