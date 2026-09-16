import Link from 'next/link'
import type { Metadata } from 'next'
import { Brand } from '@/components/Brand'
import { LinkForm } from '../LinkForm'
import styles from '../sign-in.module.css'

export const metadata: Metadata = { title: 'Set a password · PicklePicklePickle' }

/**
 * Forgotten a password, or never had one.
 *
 * One page for both, because they are the same act: prove the inbox, choose a
 * password. It is also how everybody who signed in by link before passwords
 * existed gets their first one, without an administrator doing anything.
 */
export default function Forgot() {
  return (
    <main className={styles.wrap}>
      <Brand />
      <h1 className={styles.title}>Set a password</h1>
      <p className={styles.lede}>
        Forgotten your password, or never set one? Enter the address the venue has for you and a
        link to choose a new one will be emailed there. Choosing it signs you out everywhere else.
      </p>

      <LinkForm purpose="RESET" />

      <Link href="/sign-in" className={`${styles.aside} ${styles.back}`}>
        ← Back to sign in
      </Link>
    </main>
  )
}
