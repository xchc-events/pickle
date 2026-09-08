'use client'

import { useTransition } from 'react'
import { useToast } from '@/components/Toast'
import type { Milestone } from '@/lib/finance-review'
import { toggleMilestone } from './actions'
import styles from './finance.module.css'

/**
 * The money milestones, in the order the booking model runs them.
 *
 * A held step shows why it is held rather than simply losing its button. A
 * control that vanishes reads as a bug; one that explains itself reads as a
 * decision somebody took, which is what it is.
 */
export function Milestones({ eventId, steps }: { eventId: string; steps: Milestone[] }) {
  const say = useToast()
  const [pending, start] = useTransition()

  return (
    <ol className={styles.steps}>
      {steps.map((m) => {
        // Only the two money steps are actionable. Narrowed here rather than
        // inside the handler so the type says which, instead of a cast.
        const moneyKey = m.key === 'deposit' || m.key === 'invoice' ? m.key : null

        return (
          <li key={m.key} className={`${styles.step} ${m.done ? styles.stepDone : ''}`}>
            <i
              className={`ph ${m.done ? 'ph-check-circle' : 'ph-circle-dashed'} ${styles.stepIcon}`}
              aria-hidden="true"
            />
            <span className={styles.stepBody}>
              <span className={styles.stepLabel}>{m.label}</span>
              <span className={styles.stepNote}>
                {m.heldByFlag ? 'held — finance has red-flagged this event' : m.note}
              </span>
            </span>

            {m.action && moneyKey && (
              <button
                type="button"
                className={styles.stepBtn}
                disabled={pending}
                onClick={() => start(async () => say(await toggleMilestone(eventId, moneyKey)))}
              >
                {m.action}
              </button>
            )}
          </li>
        )
      })}
    </ol>
  )
}
