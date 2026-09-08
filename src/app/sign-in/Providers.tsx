import { requestSignInLink } from './actions'
import styles from './sign-in.module.css'

/**
 * The way in.
 *
 * A server component wrapping a server action, so there is no client
 * JavaScript here at all — a sign-in page that cannot fail to hydrate is one
 * fewer way to be locked out of your own venue on a Friday night.
 *
 * Where the link lands afterwards is deliberately not decided here. Sending
 * everybody to `/pipeline` would 404 the promoters, who do not have it, so
 * the redirect goes to `/` and the app's own layout puts each person where
 * their permissions actually reach.
 *
 * The action lives in `./actions.ts` rather than inline, because what it has
 * to do — catch Auth.js's rethrown errors so a refusal reads as a sentence
 * instead of a crash — is worth testing, and an inline closure cannot be.
 */
export function SignInByEmail() {
  return (
    <form action={requestSignInLink} className={styles.emailForm}>
      <label className={styles.emailLabel} htmlFor="signin-email">
        Your email address
      </label>
      <div className={styles.emailRow}>
        <input
          id="signin-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          placeholder="you@xchc.co.nz"
          className={styles.emailInput}
        />
        <button type="submit" className={styles.provider}>
          Email me a link
        </button>
      </div>
      <p className={styles.providerNote}>
        It has to be the address the venue has on file for you. The link works once and stops
        working in an hour.
      </p>
    </form>
  )
}
