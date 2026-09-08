'use server'

import { AuthError } from 'next-auth'
import { redirect } from 'next/navigation'
import { lastLinkSentAt, signIn } from '@/lib/auth'
import { mayRequestLink, normaliseEmail } from '@/lib/auth-rules'

/**
 * Asking for a sign-in link.
 *
 * Auth.js's `signIn()` does not behave in a server action the way it does on
 * its own route: it **rethrows** an `AuthError` rather than redirecting to
 * `pages.error`. Nothing caught it, so a refusal — a throttled request, or an
 * address with no account — reached the browser as "An unexpected response
 * was received from the server" instead of the explanation the sign-in page
 * already had copy for. Catching it here is the whole point of this file.
 *
 * The cooldown is checked here as well as inside the provider. Not belt and
 * braces: only this side knows how many seconds are left in a form the page
 * can render, because Auth.js passes on an error *code* and discards the
 * sentence. The provider's own check still guards the /api/auth route.
 */
export async function requestSignInLink(formData: FormData): Promise<void> {
  const email = normaliseEmail(String(formData.get('email') ?? ''))

  // No address is not a sign-in attempt. Refused without a lookup so that an
  // empty submit cannot be used to probe the token table.
  if (!email) redirect('/sign-in?error=AccessDenied')

  const verdict = mayRequestLink(await lastLinkSentAt(email), new Date())
  if (!verdict.ok) redirect(`/sign-in?wait=${verdict.seconds}`)

  try {
    await signIn('resend', { email, redirectTo: '/' })
  } catch (err) {
    // Only Auth.js's own failures become a message. Everything else is
    // rethrown untouched — including the redirect `signIn` throws when it
    // succeeds, which is how the browser gets to the "check your email" page
    // at all, and a genuine fault, which should stay loud rather than being
    // dressed up as a sign-in problem.
    if (err instanceof AuthError) redirect(`/sign-in?error=${encodeURIComponent(err.type)}`)
    throw err
  }
}
