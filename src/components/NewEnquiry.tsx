import Link from 'next/link'
import styles from './NewEnquiry.module.css'

/**
 * Opens the enquiry form at /events/new.
 *
 * In the prototype this button raised a toast rather than creating anything:
 * an enquiry was to start life as a public event sheet the promoter filled in.
 * That sheet was never built, and until the form was, this showed a note
 * saying so. It is a plain link now, for the venue and for outside promoters
 * alike — whoever draws it decides who sees it, with `mayStartEnquiry`.
 */
export function NewEnquiry() {
  return (
    <Link href="/events/new" className={styles.button}>
      <i className="ph ph-plus" aria-hidden="true" />
      New enquiry
    </Link>
  )
}
