'use client'

import { useActionState } from 'react'
import { PasswordField } from '@/components/PasswordField'
import { changePassword } from './actions'
import styles from './account.module.css'

/**
 * Change a password you know.
 *
 * Asks for the current one even though the person is signed in: a session
 * left open on a shared laptop should be enough to use the product, not
 * enough to lock its owner out of their own account.
 */
export function ChangePassword({ email, min }: { email: string; min: number }) {
  const [state, action, pending] = useActionState(changePassword, null)

  return (
    <form action={action} className={styles.form}>
      {/* Tells a password manager whose password this is. */}
      <input
        type="email"
        name="username"
        autoComplete="username"
        value={email}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        className={styles.visuallyHidden}
      />

      <div className={styles.field}>
        <label className={styles.label} htmlFor="current-password">
          Current password
        </label>
        <PasswordField id="current-password" name="current" autoComplete="current-password" />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="new-password">
          New password
        </label>
        <PasswordField
          id="new-password"
          name="password"
          autoComplete="new-password"
          minLength={min}
          describedBy="new-password-hint"
        />
        <span id="new-password-hint" className={styles.hint}>
          At least {min} characters. A few ordinary words is easiest.
        </span>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="confirm-password">
          The same again
        </label>
        <PasswordField
          id="confirm-password"
          name="confirm"
          autoComplete="new-password"
          minLength={min}
        />
      </div>

      {state?.error ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.done ? (
        <p className={styles.done} role="status">
          {state.done}
        </p>
      ) : null}

      <button type="submit" className={styles.button} disabled={pending}>
        {pending ? 'Changing…' : 'Change password'}
      </button>
    </form>
  )
}
