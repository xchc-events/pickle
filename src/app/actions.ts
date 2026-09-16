'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { endCurrentSession } from '@/lib/auth'
import { recordAuthEvent } from '@/lib/auth-data'
import { SESSION_COOKIE, stubAllowed } from '@/lib/session'

/**
 * Sign in as a seeded user.
 *
 * This is the prototype's role picker, not authentication — there is no
 * credential to check. It exists so that permission decisions can be taken
 * server-side against a real user row without signing in and out for every
 * role. See the note at the top of src/lib/session.ts.
 */
export async function signInAs(formData: FormData) {
  // `currentUser()` already ignores this cookie in production, but this action
  // is a POST endpoint anybody can reach. It does nothing there at all.
  if (!stubAllowed) redirect('/sign-in')

  // A real session always wins over the picker's cookie, so it goes first —
  // otherwise picking a role while signed in for real would seem to do nothing.
  await endCurrentSession()

  const id = String(formData.get('userId') ?? '')
  const user = await db.user.findFirst({ where: { id, active: true } })
  if (!user) redirect('/sign-in')

  const jar = await cookies()
  jar.set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })

  // Index decides where the role can actually land.
  redirect('/')
}

/**
 * Sign out of this browser: the real session, and the development picker's
 * cookie if there is one.
 *
 * Ending the real session is the point. This used to clear only the picker's
 * cookie, so a person who pressed "sign out" was signed straight back in by
 * the session they still had.
 */
export async function signOut() {
  const ended = await endCurrentSession()
  if (ended) await recordAuthEvent('SIGNED_OUT', { email: ended.email, userId: ended.userId })

  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  redirect('/sign-in')
}
