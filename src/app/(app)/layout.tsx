import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/session'
import { modulesFor } from '@/lib/permissions'
import { Sidebar } from '@/components/Sidebar'
import { ToastProvider } from '@/components/Toast'
import styles from './shell.module.css'

/**
 * Never prerendered.
 *
 * Every page behind this layout is specific to who is asking. Next infers
 * that from the dynamic APIs a page touches, and that inference is thinner
 * than it looks: with no auth provider configured, `currentUser()` returns
 * null before it ever reads a cookie, and the whole shell prerenders to a
 * redirect. Correct today — nobody can sign in either — and exactly the kind
 * of thing that stops being correct when somebody adds a provider. Stating it
 * is cheaper than depending on the inference.
 */
export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await currentUser()
  if (!user) redirect('/sign-in')
  const modules = await modulesFor(user)

  return (
    <ToastProvider>
      <div className={styles.shell}>
        <Sidebar user={user} modules={modules} />
        <main className={styles.main}>{children}</main>
      </div>
    </ToastProvider>
  )
}
