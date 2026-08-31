import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/session'
import { modulesFor } from '@/lib/permissions'
import { BUILT_MODULES, MODULES, ROLE_LABEL } from '@/lib/constants'
import { Brand } from '@/components/Brand'
import { signOut } from './actions'
import styles from './landing.module.css'

/**
 * Where a signed-in user lands. Pipeline is the only module built so far, and
 * not every role can see it — Bar & duty manager cannot — so this decides
 * rather than sending everyone to a 404.
 */
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
        {labels || 'no modules'}, and of those, none have been built. Pipeline is the module that
        exists today.
      </p>
      <form action={signOut}>
        <button type="submit" className={styles.link}>
          Sign in as someone else
        </button>
      </form>
    </main>
  )
}
