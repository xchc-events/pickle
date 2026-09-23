'use client'

import { useState, useTransition } from 'react'
import type { Said } from '@/lib/toast'
import { useToast } from '@/components/Toast'
import styles from './promo.module.css'

/**
 * A manual channel's tick-off: the same button as `ActionButton`, plus the
 * optional link to what got posted.
 *
 * Not a `<form>` — this is one field beside a button, and a server action
 * bound to the extra argument is enough. The field is not cleared on success:
 * it is meant to hold what was just typed for a moment while the toast
 * confirms it, and the card's own URL row takes over from there once the
 * page re-renders.
 */
export function PushWithUrl({
  action,
  className,
  children,
}: {
  action: (url: string) => Promise<Said | void>
  className?: string
  children: React.ReactNode
}) {
  const say = useToast()
  const [value, setValue] = useState('')
  const [pending, start] = useTransition()

  return (
    <span className={styles.pushWithUrl}>
      <input
        type="text"
        className={styles.pushUrlInput}
        placeholder="link to what you posted (optional)"
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const said = await action(value.trim())
            if (said) say(said)
          })
        }
      >
        {children}
      </button>
    </span>
  )
}
