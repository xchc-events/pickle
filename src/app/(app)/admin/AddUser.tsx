'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import type { PersonOption } from '@/lib/admin-data'
import type { Said } from '@/lib/toast'
import type { Role } from '@/generated/prisma/client'
import styles from './admin.module.css'

/**
 * Adding somebody.
 *
 * The address is the identifying field, because it is what the provider will
 * hand back when they sign in — a mismatch of one character means they are
 * refused with no way for them to tell why. Everything else can be corrected
 * afterwards from the list above.
 */
export function AddUser({
  roles,
  people,
  organisations,
  add,
}: {
  roles: { value: Role; label: string }[]
  people: PersonOption[]
  organisations: { id: string; name: string }[]
  add: (form: FormData) => Promise<Said>
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [role, setRole] = useState<Role>('COORDINATOR')

  const external = role === 'PROMOTER'

  return (
    <form
      className={styles.add}
      action={(form) =>
        start(async () => {
          const said = await add(form)
          if (said.kind === 'good') {
            // Only clear on success — a rejected address is usually a typo,
            // and retyping it from scratch is how the typo happens again.
            ;(document.getElementById('add-user') as HTMLFormElement | null)?.reset()
            setRole('COORDINATOR')
          }
          say(said)
        })
      }
      id="add-user"
    >
      <label className={styles.field}>
        <span className={styles.label}>Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="off"
          placeholder="name@xchc.co.nz"
          className={styles.input}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Name</span>
        <input name="name" type="text" autoComplete="off" className={styles.input} />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Role</span>
        <select
          name="role"
          className={styles.input}
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>

      {external ? (
        <>
          <label className={styles.field}>
            <span className={styles.label}>Organisation</span>
            {/* Chosen from the organisations on the books, not typed. A typo
                used to mean an account scoped to a name no event carried. */}
            <select name="organisationId" className={styles.select} defaultValue="">
              <option value="">— no organisation —</option>
              {organisations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>First name</span>
            <input name="firstName" className={styles.input} placeholder="Awhina" />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Last name</span>
            <input name="lastName" className={styles.input} placeholder="Reid" />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Phone</span>
            <input name="phone" className={styles.input} placeholder="021 555 0134" />
          </label>
        </>
      ) : (
        <label className={styles.field}>
          <span className={styles.label}>Person</span>
          <select name="personId" className={styles.input} defaultValue="">
            <option value="">— none —</option>
            {people
              .filter((p) => !p.taken)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
      )}

      <button type="submit" className={styles.addButton} disabled={pending}>
        <i className="ph ph-user-plus" aria-hidden="true" />
        {pending ? 'Adding…' : 'Add'}
      </button>
    </form>
  )
}
