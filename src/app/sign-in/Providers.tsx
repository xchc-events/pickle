import { signIn } from '@/lib/auth'
import styles from './sign-in.module.css'

/**
 * The real ways in.
 *
 * Server components wrapping a server action apiece, so there is no client
 * JavaScript here at all — a sign-in page that cannot fail to hydrate is one
 * fewer way to be locked out of your own venue on a Friday night.
 */

export function SignInWithGoogle() {
  return (
    <form
      action={async () => {
        'use server'
        await signIn('google', { redirectTo: '/pipeline' })
      }}
    >
      <button type="submit" className={styles.provider}>
        <i className="ph ph-google-logo" aria-hidden="true" />
        Continue with Google
      </button>
      <p className={styles.providerNote}>For anyone with an XCHC account.</p>
    </form>
  )
}

export function SignInByEmail() {
  return (
    <form
      action={async (formData: FormData) => {
        'use server'
        await signIn('resend', {
          email: String(formData.get('email') ?? ''),
          redirectTo: '/portal',
        })
      }}
      className={styles.emailForm}
    >
      <label className={styles.emailLabel} htmlFor="signin-email">
        Or have a link emailed to you
      </label>
      <div className={styles.emailRow}>
        <input
          id="signin-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className={styles.emailInput}
        />
        <button type="submit" className={styles.provider}>
          Send link
        </button>
      </div>
      <p className={styles.providerNote}>
        For promoters working with the venue from outside. The link works once.
      </p>
    </form>
  )
}
