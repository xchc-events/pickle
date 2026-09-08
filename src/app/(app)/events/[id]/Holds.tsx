'use client'

import { useTransition } from 'react'
import { useToast } from '@/components/Toast'
import type { HoldView } from '@/lib/holds-data'
import type { Said } from '@/lib/toast'
import { challengeTheHold, dropTheHold, holdTheRoom, takeTheNight } from './actions'
import styles from './event.module.css'

/**
 * The hold ladder for this event.
 *
 * Every control here is a courtesy — each action re-checks the rule inside a
 * transaction, because two coordinators looking at this page at the same
 * moment both see a room that is free.
 *
 * A challenged hold says who is waiting. That is the only pressure in the
 * system: nothing expires, so a hold moves when somebody wants the date and
 * not before.
 */
export function Holds({
  eventId,
  holds,
  dateLabel,
  spaceName,
}: {
  eventId: string
  holds: HoldView[]
  dateLabel: string
  spaceName: string
}) {
  const say = useToast()
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<Said>) => start(async () => say(await fn()))

  if (holds.length === 0) {
    return (
      <div className={styles.holds}>
        <p className={styles.holdNone}>
          Nothing is held. {spaceName} on {dateLabel} is not claimed by this event, and nothing
          stops another booking taking it.
        </p>
        <button
          type="button"
          className={styles.holdBtn}
          disabled={pending}
          onClick={() => run(() => holdTheRoom(eventId))}
        >
          Hold the room
        </button>
      </div>
    )
  }

  return (
    <ul className={styles.holds}>
      {holds.map((h) => (
        <li key={h.id} className={styles.hold}>
          <span className={styles.holdBody}>
            <span className={styles.holdLabel}>
              {h.state === 'confirmed' ? 'Confirmed' : h.label} · {h.spaceName}
            </span>
            <span className={styles.holdNote}>
              {h.state === 'released'
                ? 'released'
                : h.challengedBy
                  ? `challenged by ${h.challengedBy} — take the night or give it up`
                  : h.state === 'confirmed'
                    ? 'the room is yours for this night'
                    : h.rank === 1
                      ? 'first refusal — nobody can confirm over this'
                      : 'behind another hold; challenge it to force a decision'}
            </span>
          </span>

          {h.state === 'held' && (
            <span className={styles.holdActions}>
              {h.canConfirm && (
                <button
                  type="button"
                  className={styles.holdBtn}
                  disabled={pending}
                  onClick={() => run(() => takeTheNight(eventId, h.id))}
                >
                  Take the night
                </button>
              )}
              {h.rank > 1 && (
                <button
                  type="button"
                  className={styles.holdGhost}
                  disabled={pending}
                  onClick={() => run(() => challengeTheHold(eventId, h.id))}
                >
                  Challenge
                </button>
              )}
              <button
                type="button"
                className={styles.holdGhost}
                disabled={pending}
                onClick={() => run(() => dropTheHold(eventId, h.id))}
              >
                Release
              </button>
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
