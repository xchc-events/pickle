import Link from 'next/link'
import type { Metadata } from 'next'
import { previewLink } from '@/lib/auth-data'
import { PASSWORD_MIN } from '@/lib/password-policy'
import { Brand } from '@/components/Brand'
import { ContinueForm, SetPasswordForm } from './Forms'
import styles from '../../sign-in.module.css'

// A link's state changes the moment it is used; nothing here can be cached.
export const dynamic = 'force-dynamic'

/**
 * The token is in this page's URL, so the page must not hand it to anybody
 * else: no Referer on anything it links to or loads, and no search index.
 */
export const metadata: Metadata = {
  title: 'Sign in · PicklePicklePickle',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
}

/**
 * Where an emailed link lands.
 *
 * **Opening this page spends nothing.** Mail services — Outlook's Safe Links
 * most of all — open every link in a message before the person does, to check
 * it. A link that signed somebody in on first open would be spent by the
 * scanner, and the person would click a dead link. So this page only looks;
 * the button on it is what spends the link, and a scanner does not press
 * buttons.
 */
export default async function LinkLanding({ params }: PageProps<'/sign-in/link/[token]'>) {
  const { token } = await params
  const link = await previewLink(token)

  if (!link || link.state !== 'open') {
    return (
      <main className={styles.wrap}>
        <Brand />
        <h1 className={styles.title}>That link does not work</h1>
        <p className={styles.lede}>{DEAD[link?.state ?? 'unknown']}</p>
        <Link href="/sign-in/forgot" className={styles.aside}>
          Get a new link to set a password →
        </Link>
        <Link href="/sign-in" className={`${styles.aside} ${styles.back}`}>
          ← Back to sign in
        </Link>
      </main>
    )
  }

  if (link.purpose === 'SIGN_IN') {
    return (
      <main className={styles.wrap}>
        <Brand />
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.lede}>
          Signing in as <strong>{link.email}</strong>. The link works once, so this button is what
          uses it.
        </p>
        <ContinueForm token={token} />
      </main>
    )
  }

  return (
    <main className={styles.wrap}>
      <Brand />
      <h1 className={styles.title}>
        {link.purpose === 'INVITE' && !link.hasPassword
          ? 'Choose your password'
          : 'Set a new password'}
      </h1>
      <p className={styles.lede}>
        For <strong>{link.email}</strong>. Use at least {PASSWORD_MIN} characters — a few ordinary
        words strung together is the easiest way there, and a password manager is easier still.
        {link.hasPassword ? ' Setting it signs you out everywhere else.' : ''}
      </p>
      <SetPasswordForm token={token} email={link.email} min={PASSWORD_MIN} />
    </main>
  )
}

const DEAD: Record<string, string> = {
  used: 'It has already been used. Each link works once — ask for a new one if you still need it.',
  expired:
    'It has expired. Links stop working after a while so an old email cannot be used to get in.',
  inactive:
    'The account it was sent to has been switched off. If that is wrong, ask an administrator at the venue.',
  unknown:
    'It is not a link this site sent, or it has been replaced by a newer one. Use the most recent email, or ask for a new link.',
}
