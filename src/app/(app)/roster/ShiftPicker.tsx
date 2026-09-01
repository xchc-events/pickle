'use client'

import { useTransition } from 'react'
import { useToast } from '@/components/Toast'
import type { Candidate } from '@/lib/roster-data'
import type { Said } from '@/lib/toast'
import styles from './roster.module.css'

/**
 * Putting somebody on a shift.
 *
 * The list is ordered by fit and carries the reason on each option, because
 * the duty manager filling a roster at 9pm on a Thursday is choosing between
 * people, not reading a report. Anybody who told us they cannot do this slot
 * is absent from the list entirely rather than shown and disabled — offering
 * them anyway is how availability stops being worth collecting.
 *
 * Over-cap people are shown, marked. The cap is a warning, not a refusal:
 * people pick up extra shifts, and the coordinator is allowed to ask. What
 * they are not allowed to do is not know.
 */
export function ShiftPicker({
  value,
  candidates,
  assign,
}: {
  value: string
  candidates: Candidate[]
  assign: (personId: string) => Promise<Said>
}) {
  const say = useToast()
  const [pending, start] = useTransition()

  return (
    <select
      className={styles.picker}
      value={value}
      disabled={pending}
      onChange={(e) => {
        const personId = e.target.value
        start(async () => say(await assign(personId)))
      }}
    >
      <option value="">— open —</option>
      {candidates.map((c) => (
        <option key={c.personId} value={c.personId}>
          {c.name}
          {c.tone === 'good' ? ' · suits them' : ''}
          {c.tone === 'warn' ? ` · ${c.booked}h of ${c.cap}h already` : ''}
        </option>
      ))}
    </select>
  )
}
