'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { SESSION_COOKIE } from '@/lib/session'

/**
 * Sign in as a seeded user.
 *
 * This is the prototype's role picker, not authentication — there is no
 * credential to check. It exists so that permission decisions can be taken
 * server-side against a real user row while real auth is still to come.
 * See the note at the top of src/lib/session.ts.
 */
export async function signInAs(formData: FormData) {
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

export async function signOut() {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  redirect('/sign-in')
}
