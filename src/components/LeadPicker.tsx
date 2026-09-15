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
 *
 * "Unassigned" reaches the action as an empty string, never null — a select's
 * value is always a string. Every action wired to this must read '' as taking
 * the lead off; set-lead.test.ts and set-design-lead.test.ts hold both to it.
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
