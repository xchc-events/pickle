import Link from 'next/link'
import { ROLE_LABEL, type ModuleKey } from '@/lib/constants'
import { navItems } from '@/lib/nav'
import type { SessionUser } from '@/lib/session'
import { Brand } from './Brand'
import { Avatar } from './Avatar'
import { NavSheet } from './NavSheet'
import { signOut } from '@/app/actions'
import styles from './Sidebar.module.css'

/**
 * Module nav for the signed-in role, in both of the shell's shapes.
 *
 * Wide, it is the sidebar. Narrow, it is a top bar whose menu button opens
 * the same nav in a sheet — src/lib/shell.ts has the breakpoint. Both are
 * rendered here, on the server, from one list: the same ModulePermission rows
 * the server checks on every request. This is a convenience, not the control
 * — a module missing from it is also unreachable by URL. See
 * src/lib/permissions.ts.
 *
 * The prototype's sidebar also carries a search button and an integrations
 * health panel. Neither is built, so neither is drawn.
 */

type NavProps = { user: SessionUser; modules: ModuleKey[] }

export function Sidebar({ user, modules }: NavProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.head}>
        <Brand />
      </div>
      <ModuleNav user={user} modules={modules} />
      <Account user={user} />
    </aside>
  )
}

/** The sidebar, folded into a bar across the top of a narrow screen. */
export function TopBar({ user, modules }: NavProps) {
  return (
    <header className={styles.topbar}>
      <Brand />
      <NavSheet>
        <ModuleNav user={user} modules={modules} />
        <Account user={user} />
      </NavSheet>
    </header>
  )
}

function ModuleNav({ user, modules }: NavProps) {
  return (
    <nav className={styles.nav} aria-label="Modules">
      {navItems(modules, user).map((item) =>
        item.href ? (
          <Link key={item.key} href={item.href} className={styles.item}>
            <i className={`ph ${item.icon} ${styles.icon}`} aria-hidden="true" />
            {item.label}
          </Link>
        ) : (
          <span key={item.key} className={`${styles.item} ${styles.unbuilt}`} title="Not built yet">
            <i className={`ph ${item.icon} ${styles.icon}`} aria-hidden="true" />
            {item.label}
          </span>
        ),
      )}
    </nav>
  )
}

function Account({ user }: { user: SessionUser }) {
  return (
    <div className={styles.foot}>
      {/* Every account's own page — password and sessions — whatever the role. */}
      <Link href="/account" className={styles.me} title="Your password and sessions">
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
      </Link>
      <form action={signOut}>
        <button type="submit" className={styles.out} title="Sign out">
          <i className="ph ph-sign-out" aria-hidden="true" />
        </button>
      </form>
    </div>
  )
}
