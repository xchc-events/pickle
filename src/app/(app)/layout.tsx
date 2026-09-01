import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/session'
import { modulesFor } from '@/lib/permissions'
import { Sidebar } from '@/components/Sidebar'
import { ToastProvider } from '@/components/Toast'
import styles from './shell.module.css'

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
