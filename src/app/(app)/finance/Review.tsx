'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import { money } from '@/lib/format'
import { riskText } from '@/lib/finance-review'
import type { ReviewPanel } from '@/lib/settlement-data'
import { approveReview, flagReview } from './actions'
import styles from './finance.module.css'

/**
 * The finance review panel.
 *
 * Sits above the settlement on both paths. Approving lets the milestone go
 * ahead; red-flagging holds it and hands the event back to the coordinator
 * with a reason they can act on.
 *
 * The reason box is not validated here beyond keeping the button honest. The
 * refusal lives in `flagReview` — a form is a courtesy and a server action is
 * a POST endpoint, so the rule has to be on the far side of it.
 */
export function Review({ eventId, review }: { eventId: string; review: ReviewPanel }) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [note, setNote] = useState('')

  const icon =
    review.state === 'approved'
      ? 'ph-seal-check'
      : review.state === 'flagged'
        ? 'ph-flag'
        : 'ph-hourglass-medium'

  return (
    <div className={`${styles.review} ${styles[`rev_${review.state}`]}`}>
      <div className={styles.revHead}>
        <span className={styles.revChip}>
          <i className={`ph ${icon}`} aria-hidden="true" />
          {review.state}
        </span>
        <span className={styles.revMilestone}>{review.milestone}</span>
      </div>

      <p className={`${styles.revRisk} ${styles[`risk_${review.health}`]}`}>
        {riskText(review.health, review.margin, review.income, review.retained, money)}
      </p>

      <p className={styles.revBlurb}>{review.blurb}</p>

      {review.state !== 'pending' && review.by && (
        <p className={styles.revBy}>
          {review.state === 'approved' ? 'Approved' : 'Flagged'} by {review.by}
          {review.when ? ` · ${review.when.toLocaleDateString('en-NZ')}` : ''}
        </p>
      )}

      {review.state === 'flagged' && review.note && (
        <p className={styles.revNote}>“{review.note}”</p>
      )}

      <div className={styles.revActions}>
        <textarea
          className={styles.revInput}
          rows={2}
          placeholder="Why is this at risk? The coordinator reads these words."
          value={note}
          disabled={pending}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className={styles.revButtons}>
          <button
            type="button"
            className={styles.revOk}
            disabled={pending}
            onClick={() =>
              start(async () => {
                say(await approveReview(eventId))
                setNote('')
              })
            }
          >
            {review.okLabel}
          </button>
          <button
            type="button"
            className={styles.revFlag}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await flagReview(eventId, note)
                say(result)
                // Only clear on success — a refused flag keeps their words so
                // they can add to them rather than retype from nothing.
                if (result.kind !== 'warn') setNote('')
              })
            }
          >
            Red-flag it
          </button>
        </div>
      </div>
    </div>
  )
}
