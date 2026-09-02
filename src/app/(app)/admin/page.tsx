import { requireModule } from '@/lib/permissions'
import { loadAdmin } from '@/lib/admin-data'
import { authConfigured, stubAllowed } from '@/lib/session'
import { SectionHeading } from '@/components/SectionHeading'
import { UserRow } from './UserRow'
import { AddUser } from './AddUser'
import { addUser, linkPerson, setActive, setRole } from './actions'
import styles from './admin.module.css'

/**
 * Admin — who has access.
 *
 * This is where accounts come from. There is no sign-up anywhere in this
 * product: the adapter in auth.ts refuses to create a user, so somebody
 * reaching the sign-in page with a perfectly good email address still gets
 * nothing until they appear on this page.
 */
export default async function AdminPage() {
  const { user } = await requireModule('admin')
  const { users, people, roles, activeAdmins, promoters } = await loadAdmin()

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Admin</h1>
          <p className={styles.sub}>
            <span className={styles.kicker}>the Keys</span> · accounts are made here, never by
            signing up · switching somebody off ends their session
          </p>
        </div>
      </header>

      {!authConfigured ? (
        <p className={styles.banner}>
          <i className="ph ph-warning" aria-hidden="true" />
          Real sign-in is not configured, so nobody here can actually sign in yet.
          {stubAllowed
            ? ' The development role picker is standing in. Set AUTH_RESEND_KEY and EMAIL_FROM — see the README.'
            : ' Set AUTH_RESEND_KEY and EMAIL_FROM — see the README.'}
        </p>
      ) : null}

      <div className={styles.body}>
        <SectionHeading
          note={`${activeAdmins} ${activeAdmins === 1 ? 'administrator' : 'administrators'}`}
        >
          Who can sign in
        </SectionHeading>

        <ul className={styles.rows}>
          {users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              people={people}
              roles={roles}
              isSelf={u.id === user.id}
              setRole={setRole.bind(null, u.id)}
              setActive={setActive.bind(null, u.id)}
              linkPerson={linkPerson.bind(null, u.id)}
            />
          ))}
        </ul>

        {activeAdmins === 1 ? (
          <p className={styles.note}>
            There is one administrator. If that account is lost, nobody can reach this page again
            without database access — a second one is worth having before it matters.
          </p>
        ) : null}

        <SectionHeading note="they cannot add themselves">Add somebody</SectionHeading>

        <AddUser roles={roles} people={people} promoters={promoters} add={addUser} />

        <p className={styles.footnote}>
          Adding an account sends nothing. Give them the address of this site and they ask for a
          sign-in link by email — staff and outside coordinators alike. The address they type has to
          match the one above exactly, or they get nothing and no explanation of why.
        </p>
      </div>
    </div>
  )
}
