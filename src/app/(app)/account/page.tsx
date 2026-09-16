import type { Metadata } from 'next'
import { requireUser } from '@/lib/permissions'
import { credentialsOf, liveSessions } from '@/lib/auth-data'
import { ROLE_LABEL } from '@/lib/constants'
import { ago, deviceOf } from '@/lib/format'
import { PASSWORD_MIN } from '@/lib/password-policy'
import { SectionHeading } from '@/components/SectionHeading'
import { ActionButton } from '@/components/ActionButton'
import { ChangePassword } from './ChangePassword'
import { emailMePasswordLink, endOtherSession, signOutEverywhereElse } from './actions'
import styles from './account.module.css'

export const metadata: Metadata = { title: 'Your account · PicklePicklePickle' }

/**
 * Your account — your password, and where you are signed in.
 *
 * Every account has this page whatever its role, so it is gated on being
 * signed in rather than on a module. It shows only the account asking; there
 * is no id in the URL to change.
 */
export default async function AccountPage() {
  const user = await requireUser()

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Your account</h1>
          <p className={styles.sub}>
            {user.email} · {ROLE_LABEL[user.roleKey]}
            {user.organisationName ? ` · ${user.organisationName}` : ''}
          </p>
        </div>
      </header>

      {user.sessionId ? (
        <Signed userId={user.id} sessionId={user.sessionId} />
      ) : (
        <p className={styles.banner}>
          <i className="ph ph-warning" aria-hidden="true" />
          You are signed in through the development role picker. It has no password and no sessions
          of its own, so there is nothing to manage here — sign in for real to see this page
          properly.
        </p>
      )}
    </div>
  )
}

async function Signed({ userId, sessionId }: { userId: string; sessionId: string }) {
  const [account, sessions] = await Promise.all([credentialsOf(userId), liveSessions(userId)])
  if (!account) return null

  const now = new Date()
  const others = sessions.filter((s) => s.id !== sessionId)

  return (
    <div className={styles.body}>
      <section>
        <SectionHeading
          note={
            account.passwordHash
              ? account.passwordChangedAt
                ? `changed ${ago(account.passwordChangedAt, now)}`
                : 'set'
              : 'not set'
          }
        >
          Password
        </SectionHeading>

        {account.passwordHash ? (
          <>
            <ChangePassword email={account.email} min={PASSWORD_MIN} />
            <p className={styles.footnote}>
              Forgotten the current one?{' '}
              <ActionButton action={emailMePasswordLink} className={styles.inlineButton}>
                Email me a link to set a new one
              </ActionButton>
            </p>
          </>
        ) : (
          <div className={styles.empty}>
            <p>
              There is no password on this account yet — you have been signing in with emailed
              links. Setting one takes a link to your inbox, so that a session left open somewhere
              is not enough to put a password on your account.
            </p>
            <ActionButton action={emailMePasswordLink} className={styles.button}>
              <i className="ph ph-envelope-simple" aria-hidden="true" />
              Email me a link to set a password
            </ActionButton>
          </div>
        )}
      </section>

      <section>
        <SectionHeading note={`${sessions.length} signed in`}>
          Where you are signed in
        </SectionHeading>

        <ul className={styles.sessions}>
          {sessions.map((s) => {
            const here = s.id === sessionId
            return (
              <li key={s.id} className={styles.session}>
                <i
                  className={`ph ${/iPhone|Android/.test(s.userAgent ?? '') ? 'ph-device-mobile' : 'ph-desktop'} ${styles.sessionIcon}`}
                  aria-hidden="true"
                />
                <span className={styles.sessionWho}>
                  <span className={styles.sessionName}>
                    {deviceOf(s.userAgent)}
                    {here ? <span className={styles.here}>this browser</span> : null}
                  </span>
                  <span className={styles.sessionMeta}>
                    Signed in {ago(s.createdAt, now)} with{' '}
                    {s.method === 'PASSWORD' ? 'a password' : 'an emailed link'} · last used{' '}
                    {here ? 'now' : ago(s.lastSeenAt, now)}
                  </span>
                </span>
                {here ? null : (
                  <ActionButton
                    action={endOtherSession.bind(null, s.id)}
                    className={styles.endButton}
                  >
                    Sign out
                  </ActionButton>
                )}
              </li>
            )
          })}
        </ul>

        {others.length > 1 ? (
          <ActionButton action={signOutEverywhereElse} className={styles.button}>
            <i className="ph ph-sign-out" aria-hidden="true" />
            Sign out everywhere else
          </ActionButton>
        ) : null}

        <p className={styles.footnote}>
          A session ends by itself after two weeks unused, and thirty days after signing in whatever
          happens. Changing your password signs out everywhere but here.
        </p>
      </section>
    </div>
  )
}
