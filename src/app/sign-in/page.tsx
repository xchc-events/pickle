import Link from 'next/link'
import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { ROLE_LABEL, MODULES } from '@/lib/constants'
import { currentUser, roleKeyOf, stubAllowed } from '@/lib/session'
import { modulesOpenByRole } from '@/lib/scope'
import { emailConfigured } from '@/lib/email'
import { initialsOf } from '@/lib/format'
import { Brand } from '@/components/Brand'
import { Avatar } from '@/components/Avatar'
import { signInAs, signOut } from '../actions'
import { PasswordForm } from './PasswordForm'
import { LinkForm } from './LinkForm'
import styles from './sign-in.module.css'

// Reads the session and the user table on every request: a page baked at build
// time would go stale the moment anyone is added or deactivated.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Sign in · PicklePicklePickle' }

/**
 * The way in.
 *
 * A password first, because that is what most people will use most days. The
 * emailed link sits under it, folded away — still there for somebody who has
 * not set a password, whose password is throttled, or who simply prefers it —
 * and it needs no JavaScript to unfold.
 *
 * There is no sign-up link, because there is no sign-up.
 */
export default async function SignIn() {
  const already = await currentUser()

  return (
    <main className={styles.wrap}>
      <Brand />
      <h1 className={styles.title}>Sign in</h1>

      {already ? (
        <div className={styles.already}>
          <span>
            You are signed in as <strong>{already.name}</strong>
            {already.authenticated ? '' : ' through the development picker'}.
          </span>
          <span className={styles.alreadyActions}>
            <Link href="/" className={styles.aside}>
              Carry on
            </Link>
            <form action={signOut}>
              <button type="submit" className={styles.asideButton}>
                Sign out
              </button>
            </form>
          </span>
        </div>
      ) : null}

      <PasswordForm />

      <details className={styles.alt}>
        <summary className={styles.altSummary}>Email me a sign-in link instead</summary>
        <div className={styles.altBody}>
          <LinkForm purpose="SIGN_IN" />
        </div>
      </details>

      {!emailConfigured() ? (
        <p className={styles.note}>
          {stubAllowed
            ? 'Email is not set up on this install, so links are written to the dev server’s log instead of being sent.'
            : 'Email is not set up on this install, so links cannot be sent. Ask an administrator.'}
        </p>
      ) : null}

      <p className={styles.blurb}>
        There is no sign-up here. Accounts are made by an administrator at the venue, and the first
        password comes from the invitation they send.
      </p>

      {stubAllowed ? <RolePicker /> : null}
    </main>
  )
}

/**
 * The prototype's role picker.
 *
 * Development only — `stubAllowed` is false in production, and `currentUser()`
 * refuses the cookie there regardless, so this cannot be reached on a real
 * install even if somebody links to it. It stays because switching between
 * roles is the fastest way to check that a permission actually holds, and
 * because a session it grants is marked unauthenticated: it can drive every
 * module but it can never open a bank account.
 */
async function RolePicker() {
  const users = await db.user.findMany({
    where: { active: true },
    include: { person: true },
    orderBy: { createdAt: 'asc' },
  })

  // What each role can open, as its sidebar will show it — not the raw rows.
  const modulesByRole = modulesOpenByRole(await db.modulePermission.findMany())

  return (
    <section className={styles.dev}>
      <div className={styles.devHead}>
        <span className={styles.devTag}>development only</span>
        <span className={styles.devNote}>Alongside real sign-in above.</span>
      </div>

      <div className={styles.list}>
        {users.map((u) => {
          const roleKey = roleKeyOf(u.role)
          const mods = modulesByRole.get(u.role) ?? []
          const labels = MODULES.filter((m) => mods.includes(m.key))
            .map((m) => m.label)
            .join(' · ')
          return (
            <form key={u.id} action={signInAs}>
              <input type="hidden" name="userId" value={u.id} />
              <button type="submit" className={styles.row}>
                <Avatar
                  initials={u.person?.initials ?? initialsOf(u.name ?? u.email)}
                  title={u.name ?? ''}
                  accent={u.person?.initials === 'MT'}
                  external={u.role === 'PROMOTER'}
                />
                <span className={styles.who}>
                  <span className={styles.name}>{u.name}</span>
                  <span className={styles.role}>
                    {ROLE_LABEL[roleKey]}
                    {u.promoter ? ` · ${u.promoter}` : ''}
                  </span>
                </span>
                <span className={styles.mods}>{labels}</span>
              </button>
            </form>
          )
        })}
      </div>

      <p className={styles.foot}>
        No password: the role is held in a cookie, and anyone who can set that cookie can be anyone.
        A session from here is marked unauthenticated, so it drives every module but cannot open a
        payment detail — or change a password.
      </p>
    </section>
  )
}
