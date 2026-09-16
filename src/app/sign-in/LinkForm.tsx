'use client'

import { useActionState } from 'react'
import { requestPasswordLink, requestSignInLink } from './actions'
import styles from './sign-in.module.css'

/**
 * "Email me a link" — to sign in, or to set a password.
 *
 * The confirmation is worded for an address that may have no account,
 * because the server answers every address the same way and this is the only
 * thing the person sees. It repeats the address back, which is what lets
 * somebody spot the typo that explains why nothing arrived.
 */
export function LinkForm({ purpose }: { purpose: 'SIGN_IN' | 'RESET' }) {
  const [state, action, pending] = useActionState(
    purpose === 'SIGN_IN' ? requestSignInLink : requestPasswordLink,
    null,
  )

  if (state?.sentTo) {
    return (
      <p className={styles.sent} role="status">
        If <strong>{state.sentTo}</strong> has an account here, a link is on its way. It works once
        and stops working in an hour. Nothing arriving? Check the address, check the spam folder, or
        ask an administrator at the venue.
      </p>
    )
  }

  const id = `link-email-${purpose.toLowerCase()}`
  return (
    <form action={action} className={styles.form}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={id}>
          Email address
        </label>
        <div className={styles.inline}>
          <input
            id={id}
            name="email"
            type="email"
            required
            autoComplete="username"
            placeholder="you@xchc.co.nz"
            className={styles.input}
          />
          <button type="submit" className={styles.secondary} disabled={pending}>
            {pending ? 'Sending…' : 'Email me a link'}
          </button>
        </div>
      </div>
      {state?.error ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
