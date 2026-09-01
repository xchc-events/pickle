'use client'

import { useTransition } from 'react'
import type { Said } from '@/lib/toast'
import { useToast } from './Toast'
import styles from './LeadPicker.module.css'

/**
 * Who owns a department on an event.
 *
 * The options are people, not typed-in names — renaming somebody in Admin
 * renames them here, on their shifts and on their timesheets at once, because
 * there is only one record of a person.
 */
export function LeadPicker({
  action,
  value,
  options,
  label,
}: {
  action: (personId: string) => Promise<Said | void>
  value: string
  options: { personId: string; name: string }[]
  label: string
}) {
  const say = useToast()
  const [pending, start] = useTransition()

  return (
    <select
      className={styles.select}
      aria-label={label}
      defaultValue={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value
        start(async () => {
          const said = await action(next)
          if (said) say(said)
        })
      }}
    >
      <option value="">Unassigned</option>
      {options.map((o) => (
        <option key={o.personId} value={o.personId}>
          {o.name}
        </option>
      ))}
    </select>
  )
}
