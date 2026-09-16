'use client'

import { useState } from 'react'
import styles from './PasswordField.module.css'

/**
 * A password box with a Show button.
 *
 * Long passwords are the whole policy (src/lib/password-policy.ts), and a
 * fifteen-character passphrase typed blind on a phone is how people end up
 * choosing a short one instead. Showing it is the person's choice, off by
 * default, and it goes back to hidden on every page load.
 *
 * `autoComplete` matters more than it looks: `current-password` and
 * `new-password` are what tell a password manager to fill one in, or to offer
 * a generated one and save it.
 */
export function PasswordField({
  id,
  name,
  autoComplete,
  minLength,
  describedBy,
}: {
  id: string
  name: string
  autoComplete: 'current-password' | 'new-password'
  minLength?: number
  describedBy?: string
}) {
  const [shown, setShown] = useState(false)

  return (
    <div className={styles.row}>
      <input
        id={id}
        name={name}
        type={shown ? 'text' : 'password'}
        required
        autoComplete={autoComplete}
        // Deliberately not maxLength: the browser counts UTF-16 units, which
        // would refuse a password the server accepts.
        minLength={minLength}
        aria-describedby={describedBy}
        spellCheck={false}
        autoCapitalize="off"
        className={styles.input}
      />
      <button
        type="button"
        className={styles.reveal}
        aria-controls={id}
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
