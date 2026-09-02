import { db } from '@/lib/db'
import { ROLE_LABEL, MODULES, type ModuleKey } from '@/lib/constants'
import { roleKeyOf, authConfigured, stubAllowed } from '@/lib/session'
import { initialsOf } from '@/lib/format'
import { Brand } from '@/components/Brand'
import { Avatar } from '@/components/Avatar'
import { signInAs } from '../actions'
import { SignInByEmail } from './Providers'
import styles from './sign-in.module.css'

// Reads the user table on every request: a signed-in list baked at build time
// would go stale the moment anyone is added or deactivated.
export const dynamic = 'force-dynamic'

const REASON: Record<string, string> = {
  AccessDenied:
    'That address has no account here, or its account has been switched off. Accounts are made by an administrator at the venue — there is no sign-up.',
  Verification:
    'That link has been used already, or it expired, or one was sent to that address a moment ago. Check the inbox, then ask for a new one.',
  Configuration:
    'Sign-in is not configured on this install. An administrator needs to set the Resend keys — see the README.',
}

export default async function SignIn({ searchParams }: PageProps<'/sign-in'>) {
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : null
  const sent = sp.sent === '1'

  return (
    <main className={styles.wrap}>
      <Brand />
      <h1 className={styles.title}>Sign in</h1>

      {error ? (
        <p className={styles.error} role="alert">
          {REASON[error] ?? 'That did not work. Try again, or ask an administrator at the venue.'}
        </p>
      ) : null}

      {sent ? (
        <p className={styles.sent} role="status">
          Check your email — the link signs you in, works once, and expires in an hour.
        </p>
      ) : null}

      {authConfigured ? (
        <>
          <p className={styles.blurb}>
            Use the address the venue added for you. There is no sign-up here and no password to
            remember.
          </p>
          <div className={styles.providers}>
            <SignInByEmail />
          </div>
        </>
      ) : (
        <p className={styles.blurb}>
          Real sign-in is not configured on this install yet — see the README for the Resend keys.
        </p>
      )}

      {stubAllowed ? <RolePicker realAuth={authConfigured} /> : null}
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
async function RolePicker({ realAuth }: { realAuth: boolean }) {
  const users = await db.user.findMany({
    where: { active: true },
    include: { person: true },
    orderBy: { createdAt: 'asc' },
  })

  const perms = await db.modulePermission.findMany()
  const modulesByRole = new Map<string, ModuleKey[]>()
  for (const p of perms) {
    const list = modulesByRole.get(p.role) ?? []
    list.push(p.module as ModuleKey)
    modulesByRole.set(p.role, list)
  }

  return (
    <section className={styles.dev}>
      <div className={styles.devHead}>
        <span className={styles.devTag}>development only</span>
        <span className={styles.devNote}>
          {realAuth ? 'Alongside real sign-in above.' : 'Standing in for real sign-in.'}
        </span>
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
        payment detail.
      </p>
    </section>
  )
}
