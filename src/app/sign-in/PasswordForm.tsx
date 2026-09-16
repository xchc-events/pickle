'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { PasswordField } from '@/components/PasswordField'
import { signInWithPassword } from './actions'
import styles from './sign-in.module.css'

/**
 * Email and password.
 *
 * A client component only for `useActionState`, which keeps the address in
 * the box and the reason beside it after a refusal. It still works before
 * hydration: the form posts to the server action like any form would, so a
 * slow bar laptop is never locked out by JavaScript that has not loaded.
 */
export function PasswordForm() {
  const [state, action, pending] = useActionState(signInWithPassword, null)

  return (
    <form action={action} className={styles.form}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="signin-email">
          Email address
        </label>
        <input
          id="signin-email"
          name="email"
          type="email"
          required
          // `username`, not `email`: it is what password managers look for to
          // know which account a saved password belongs to.
          autoComplete="username"
          autoFocus
          defaultValue={state?.email}
          placeholder="you@xchc.co.nz"
          className={styles.input}
        />
      </div>

      <div className={styles.field}>
        <div className={styles.labelRow}>
          <label className={styles.label} htmlFor="signin-password">
            Password
          </label>
          <Link href="/sign-in/forgot" className={styles.aside}>
            Forgotten it, or never set one?
          </Link>
        </div>
        <PasswordField id="signin-password" name="password" autoComplete="current-password" />
      </div>

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
