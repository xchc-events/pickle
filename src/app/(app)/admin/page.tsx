import { requireModule } from '@/lib/permissions'
import { loadAdmin } from '@/lib/admin-data'
import { stubAllowed } from '@/lib/session'
import { emailConfigured } from '@/lib/email'
import { SectionHeading } from '@/components/SectionHeading'
import { UserRow } from './UserRow'
import { AddUser } from './AddUser'
import {
  addUser,
  endSessionsFor,
  linkPerson,
  sendInvite,
  setActive,
  setOrganisation,
  setRole,
} from './actions'
import styles from './admin.module.css'

/**
 * Admin — who has access.
 *
 * This is where accounts come from. There is no sign-up anywhere in this
 * product: nothing on the sign-in path can create a user (src/lib/auth.ts), so
 * somebody reaching the sign-in page with a perfectly good email address still
 * gets nothing until they appear on this page.
 */
export default async function AdminPage() {
  const { user } = await requireModule('admin')
  const { users, people, roles, activeAdmins, organisations } = await loadAdmin()

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

      {!emailConfigured() ? (
        <p className={styles.banner}>
          <i className="ph ph-warning" aria-hidden="true" />
          Email is not configured, so invitations and password links cannot be sent.
          {stubAllowed
            ? ' On this dev server they are written to the server log instead. Set AUTH_RESEND_KEY and EMAIL_FROM to send them — see the README.'
            : ' Set AUTH_RESEND_KEY and EMAIL_FROM — see the README. People who already have a password can still sign in.'}
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
              organisations={organisations}
              setRole={setRole.bind(null, u.id)}
              setActive={setActive.bind(null, u.id)}
              linkPerson={linkPerson.bind(null, u.id)}
              setOrganisation={setOrganisation.bind(null, u.id)}
              sendInvite={sendInvite.bind(null, u.id)}
              endSessions={endSessionsFor.bind(null, u.id)}
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

        <AddUser roles={roles} people={people} organisations={organisations} add={addUser} />

        <p className={styles.footnote}>
          The invitation is a link to choose their own password, and it lasts a week. Nobody here
          ever sees or sets it. After that they sign in with their address and password, or ask for
          a link by email — staff and outside coordinators alike. Anybody who forgets their password
          sets a new one from the sign-in page without needing you.
        </p>
      </div>
    </div>
  )
}
