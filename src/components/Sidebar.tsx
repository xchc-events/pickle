import Link from 'next/link'
import { BUILT_MODULES, MODULES, ROLE_LABEL, type ModuleKey } from '@/lib/constants'
import type { SessionUser } from '@/lib/session'
import { Brand } from './Brand'
import { Avatar } from './Avatar'
import { signOut } from '@/app/actions'
import styles from './Sidebar.module.css'

/**
 * Module nav for the signed-in role.
 *
 * The list here comes from the same ModulePermission rows the server checks
 * on every request — this is a convenience, not the control. A module missing
 * from it is also unreachable by URL. See src/lib/permissions.ts.
 *
 * The prototype's sidebar also carries a search button and an integrations
 * health panel. Neither is built, so neither is drawn.
 */
export function Sidebar({ user, modules }: { user: SessionUser; modules: ModuleKey[] }) {
  const visible = MODULES.filter((m) => modules.includes(m.key))

  return (
    <aside className={styles.sidebar}>
      <div className={styles.head}>
        <Brand />
      </div>

      <nav className={styles.nav}>
        {visible.map((m) => {
          const built = BUILT_MODULES.includes(m.key)
          const label = m.key === 'pipeline' && user.external ? 'Your events' : m.label
          if (!built) {
            return (
              <span
                key={m.key}
                className={`${styles.item} ${styles.unbuilt}`}
                title="Not built yet"
              >
                <i className={`ph ${m.icon} ${styles.icon}`} aria-hidden="true" />
                {label}
              </span>
            )
          }
          return (
            <Link key={m.key} href={`/${m.key}`} className={styles.item}>
              <i className={`ph ${m.icon} ${styles.icon}`} aria-hidden="true" />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className={styles.foot}>
        <Avatar
          initials={user.initials}
          title={user.name}
          accent={user.initials === 'MT'}
          external={user.external}
        />
        <span className={styles.who}>
          <span className={styles.name}>{user.name}</span>
          <span className={styles.role}>
            {ROLE_LABEL[user.roleKey]}
            {user.organisationName ? ` · ${user.organisationName}` : ''}
          </span>
        </span>
        <form action={signOut}>
          <button type="submit" className={styles.out} title="Sign out">
            <i className="ph ph-sign-out" aria-hidden="true" />
          </button>
        </form>
      </div>
    </aside>
  )
}
