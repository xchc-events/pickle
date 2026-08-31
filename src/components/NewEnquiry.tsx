'use client'

import { useState } from 'react'
import styles from './NewEnquiry.module.css'

/**
 * In the prototype this button raises a toast rather than creating anything:
 * an enquiry starts life as the public event sheet the promoter fills in, so
 * the venue never re-types it. That form does not exist yet, and neither does
 * the toast layer, so the explanation is shown inline instead.
 */
export function NewEnquiry() {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.button} onClick={() => setOpen((v) => !v)}>
        <i className="ph ph-plus" aria-hidden="true" />
        New enquiry
      </button>
      {open ? (
        <p className={styles.note} role="status">
          A new enquiry starts as the public event sheet — the promoter fills it, you never re-type
          it. That form is not built yet.
        </p>
      ) : null}
    </div>
  )
}
