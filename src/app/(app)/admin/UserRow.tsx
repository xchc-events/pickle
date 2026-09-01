'use client'

import { useTransition } from 'react'
import { useToast } from '@/components/Toast'
import type { AdminUser, PersonOption } from '@/lib/admin-data'
import type { Said } from '@/lib/toast'
import type { Role } from '@/generated/prisma/client'
import styles from './admin.module.css'

/**
 * One account, and the three things that can be changed about it.
 *
 * Everything saves on change rather than behind a Save button. There is no
 * draft state here worth protecting — each control is one field, and a row
 * that looks changed but is not saved is worse than a change that lands.
 */
export function UserRow({
  user,
  people,
  roles,
  isSelf,
  setRole,
  setActive,
  linkPerson,
}: {
  user: AdminUser
  people: PersonOption[]
  roles: { value: Role; label: string }[]
  isSelf: boolean
  setRole: (role: Role) => Promise<Said>
  setActive: (active: boolean) => Promise<Said>
  linkPerson: (personId: string) => Promise<Said>
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const run = (fn: () => Promise<Said>) => start(async () => say(await fn()))

  return (
    <li className={`${styles.row} ${user.active ? '' : styles.rowOff}`}>
      <div className={styles.who}>
        <span className={styles.name}>
          {user.name}
          {isSelf ? <span className={styles.you}>you</span> : null}
        </span>
        <span className={styles.email}>{user.email}</span>
      </div>

      <select
        className={styles.select}
        value={user.role}
        disabled={pending}
        onChange={(e) => run(() => setRole(e.target.value as Role))}
      >
        {roles.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>

      {user.role === 'PROMOTER' ? (
        <span className={styles.org}>
          {user.promoter ?? <em className={styles.warn}>no org</em>}
        </span>
      ) : (
        <select
          className={styles.select}
          value={user.personId ?? ''}
          disabled={pending}
          onChange={(e) => run(() => linkPerson(e.target.value))}
        >
          <option value="">— not linked —</option>
          {people
            .filter((p) => !p.taken || p.id === user.personId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      )}

      <span className={styles.signedIn}>
        {user.everSignedIn ? (
          <span className={styles.good} title="Has signed in with a real credential">
            <i className="ph ph-check-circle" aria-hidden="true" />
            signed in
          </span>
        ) : (
          <span className={styles.quiet}>never signed in</span>
        )}
        {user.liveSessions > 0 ? (
          <span className={styles.sessions}>
            {user.liveSessions} open {user.liveSessions === 1 ? 'session' : 'sessions'}
          </span>
        ) : null}
      </span>

      <button
        type="button"
        className={`${styles.toggle} ${user.active ? styles.toggleOn : ''}`}
        disabled={pending}
        title={user.active ? 'Switch this account off' : 'Let them sign in again'}
        onClick={() => run(() => setActive(!user.active))}
      >
        {user.active ? 'active' : 'off'}
      </button>

      {user.problems.length ? (
        <ul className={styles.problems}>
          {user.problems.map((p) => (
            <li key={p}>
              <i className="ph ph-warning" aria-hidden="true" />
              {p}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}
