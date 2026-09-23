'use client'

import { useEffect, useRef, useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { ActionButton } from '@/components/ActionButton'
import type { Said } from '@/lib/toast'
import styles from './roster.module.css'

/**
 * The avatar on a shift row, made a button.
 *
 * "Click their little symbol to view their contact information so you can
 * call or text, or push a button to send an email alert that they've been
 * offered a shift" (Connor). Only for a shift with somebody on it already —
 * an unfilled shift's '?' stays exactly the plain, non-interactive `Avatar`
 * it always was; there is nothing to show a popover about.
 */
export function ContactAvatar({
  initials,
  name,
  email,
  phone,
  canEmailOffer,
  emailOffer,
}: {
  initials: string | null
  name: string | null
  email: string | null
  phone: string | null
  /** Whether "Email the offer" belongs in the popover — only while OFFERED. */
  canEmailOffer: boolean
  emailOffer: () => Promise<Said>
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (initials === null || name === null) {
    return <Avatar initials="?" title="Unfilled" />
  }

  return (
    <div className={styles.contact} ref={wrap}>
      <button
        type="button"
        className={styles.avatarButton}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        title={`${name} — click for contact details`}
      >
        <Avatar initials={initials} title={name} accent />
      </button>

      {open ? (
        <div className={styles.contactPopover}>
          <span className={styles.contactName}>{name}</span>
          {email ? (
            <span className={styles.contactLine}>{email}</span>
          ) : (
            <span className={styles.contactEmpty}>no email on file</span>
          )}
          {phone ? (
            <span className={styles.contactLine}>{phone}</span>
          ) : (
            <span className={styles.contactEmpty}>no phone on file</span>
          )}
          {canEmailOffer ? (
            <ActionButton className={styles.contactEmailButton} action={emailOffer}>
              Email the offer
            </ActionButton>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
