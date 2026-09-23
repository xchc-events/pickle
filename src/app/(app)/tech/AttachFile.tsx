'use client'

import { useState, useTransition } from 'react'
import type { Said } from '@/lib/toast'
import { useToast } from '@/components/Toast'
import styles from './tech.module.css'

/**
 * The picker on an unassigned file: which act it belongs to.
 *
 * Everything uploaded before riders were per act has no act, and stays here
 * until somebody says whose it is — this is that saying.
 */
export function AttachFile({
  acts,
  attach,
}: {
  acts: { id: string; name: string }[]
  attach: (artistId: string) => Promise<Said>
}) {
  const say = useToast()
  const [value, setValue] = useState('')
  const [pending, start] = useTransition()

  return (
    <span className={styles.attach}>
      <select
        className={styles.attachSelect}
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
      >
        <option value="">attach to…</option>
        {acts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={styles.attachButton}
        disabled={pending || !value}
        onClick={() =>
          start(async () => {
            const said = await attach(value)
            say(said)
          })
        }
      >
        Attach
      </button>
    </span>
  )
}
