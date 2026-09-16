'use client'

import { useActionState } from 'react'
import { PasswordField } from '@/components/PasswordField'
import { continueWithLink, setPasswordFromLink } from './actions'
import styles from '../../sign-in.module.css'

/**
 * The two buttons an emailed link leads to. Both work before hydration, like
 * the sign-in form.
 *
 * The token travels as a hidden field. It is already in the page's URL, so
 * this puts it nowhere new — it is only how the action learns which link it is
 * spending.
 */

export function ContinueForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(continueWithLink, null)

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="token" value={token} />
      {state?.error ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

/**
 * `min` comes from the server page rather than an import, so the password
 * policy module stays out of the browser bundle.
 */
export function SetPasswordForm({
  token,
  email,
  min,
}: {
  token: string
  email: string
  min: number
}) {
  const [state, action, pending] = useActionState(setPasswordFromLink, null)

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="token" value={token} />
      {/* So a password manager saves the new password against the right
          account, rather than guessing from whatever else is on the page. */}
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
        <p id="new-password-hint" className={styles.hint}>
          At least {min} characters. No rules about capitals or symbols — length is what counts.
        </p>
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

      <button type="submit" className={styles.primary} disabled={pending}>
        {pending ? 'Saving…' : 'Save password and sign in'}
      </button>
    </form>
  )
}
