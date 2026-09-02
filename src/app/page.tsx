import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/session'
import { modulesFor } from '@/lib/permissions'
import { BUILT_MODULES, MODULES, ROLE_LABEL } from '@/lib/constants'
import { Brand } from '@/components/Brand'
import { signOut } from './actions'
import styles from './landing.module.css'

/**
 * Where a signed-in user lands.
 *
 * Not every role can see Pipeline — Bar & duty manager cannot — so this picks
 * the first module their role actually reaches rather than sending everybody
 * to one URL and 404ing half of them. Sign-in redirects here for that reason;
 * see `SignInByEmail` in src/app/sign-in/Providers.tsx.
 */
/**
 * Never prerendered.
 *
 * This page reads the session and routes each person to a module their role
 * actually reaches, so it is per-user by definition. Next infers dynamism
 * from the APIs a page touches, and that inference is thinner than it looks:
 * with no provider configured at build time, `currentUser()` returns null
 * before it ever reads a cookie, and the page prerenders to a redirect to
 * /sign-in. That redirect would then be served to everybody — including
 * people who had just signed in, since sign-in lands here — which is a loop
 * back to the sign-in page. Stating it is cheaper than depending on the
 * build environment matching the runtime one.
 */
export const dynamic = 'force-dynamic'

export default async function Index() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const modules = await modulesFor(user)
  const built = modules.filter((m) => BUILT_MODULES.includes(m))
  if (built.includes('pipeline')) redirect('/pipeline')
  if (built.length) redirect(`/${built[0]}`)

  const labels = modules
    .map((k) => MODULES.find((m) => m.key === k)?.label)
    .filter(Boolean)
    .join(', ')

  return (
    <main className={styles.wrap}>
      <Brand />
      <h1 className={styles.title}>Nothing you can see is built yet</h1>
      <p className={styles.body}>
        You are signed in as {user.name} — {ROLE_LABEL[user.roleKey]}. That role can see{' '}
        {labels || 'no modules'}, and of those, none have been built yet.
      </p>
      <form action={signOut}>
        <button type="submit" className={styles.link}>
          Sign in as someone else
        </button>
      </form>
    </main>
  )
}
