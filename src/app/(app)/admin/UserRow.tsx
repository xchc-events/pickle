'use client'

import { useTransition } from 'react'
import { useToast } from '@/components/Toast'
import type { AdminUser, PersonOption } from '@/lib/admin-data'
import type { Said } from '@/lib/toast'
import { payRate } from '@/lib/finance'
import { money } from '@/lib/format'
import type { Employment, Role } from '@/generated/prisma/client'
import styles from './admin.module.css'

/** Connor's 22 Sep 2026 pay policy — read off finance.ts, never typed twice. */
const EMPLOYMENTS: { value: Employment; label: string }[] = [
  { value: 'CONTRACTOR', label: `Contractor · ${money(payRate('CONTRACTOR'))}/h` },
  { value: 'EMPLOYEE', label: `Employee · ${money(payRate('EMPLOYEE'))}/h base` },
]

/**
 * One account, and the things that can be changed about it.
 *
 * Everything saves on change rather than behind a Save button. There is no
 * draft state here worth protecting — each control is one field, and a row
 * that looks changed but is not saved is worse than a change that lands.
 *
 * A password never appears here in any form. The row says whether one is
 * set, and an account without one can be sent an invitation to choose it.
 */
export function UserRow({
  user,
  people,
  roles,
  isSelf,
  organisations,
  setRole,
  setActive,
  linkPerson,
  setOrganisation,
  setEmployment,
  sendInvite,
  endSessions,
}: {
  user: AdminUser
  people: PersonOption[]
  roles: { value: Role; label: string }[]
  isSelf: boolean
  organisations: { id: string; name: string }[]
  setOrganisation: (organisationId: string) => Promise<Said>
  setRole: (role: Role) => Promise<Said>
  setActive: (active: boolean) => Promise<Said>
  linkPerson: (personId: string) => Promise<Said>
  setEmployment: (employment: Employment) => Promise<Said>
  sendInvite: () => Promise<Said>
  endSessions: () => Promise<Said>
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
        /* Several accounts may point at one organisation — that is how a
           label with three promoters is set up. Nothing stops two rows
           choosing the same one. */
        <select
          className={styles.select}
          value={user.organisationId ?? ''}
          disabled={pending}
          onChange={(e) => run(() => setOrganisation(e.target.value))}
        >
          <option value="">— no organisation —</option>
          {organisations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : (
        <>
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

          {/* Pay is a person's, not the account's — there is nowhere to put
              it until the account is linked to one. */}
          <select
            className={styles.select}
            value={user.employment ?? ''}
            disabled={pending || !user.personId}
            title={!user.personId ? 'Link a person first' : 'Standard pay rate'}
            onChange={(e) => run(() => setEmployment(e.target.value as Employment))}
          >
            {!user.personId ? <option value="">— not linked —</option> : null}
            {EMPLOYMENTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </>
      )}

      <span className={styles.signedIn}>
        {user.lastSignIn ? (
          <span className={styles.good} title="Last signed in with a real credential">
            <i className="ph ph-check-circle" aria-hidden="true" />
            signed in {user.lastSignIn}
          </span>
        ) : (
          <span className={styles.quiet}>never signed in</span>
        )}

        {user.hasPassword ? (
          <span className={styles.quiet}>password set</span>
        ) : user.active ? (
          <button
            type="button"
            className={styles.inlineAction}
            disabled={pending}
            title="Email them a link to choose a password. It lasts 7 days."
            onClick={() => run(sendInvite)}
          >
            no password · send invitation
          </button>
        ) : (
          <span className={styles.quiet}>no password</span>
        )}

        {user.liveSessions > 0 ? (
          isSelf ? (
            <span className={styles.sessions}>
              {user.liveSessions} open {user.liveSessions === 1 ? 'session' : 'sessions'}
            </span>
          ) : (
            <button
              type="button"
              className={`${styles.inlineAction} ${styles.sessions}`}
              disabled={pending}
              title="Sign them out of every browser. They can sign back in."
              onClick={() => run(endSessions)}
            >
              {user.liveSessions} open {user.liveSessions === 1 ? 'session' : 'sessions'} · end
            </button>
          )
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
