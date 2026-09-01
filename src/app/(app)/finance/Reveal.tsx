'use client'

import { useEffect, useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import type { RevealResponse } from './actions'
import styles from './finance.module.css'

/** How long the plaintext stays on screen before it puts itself away. */
const HOLD_SECONDS = 45

/**
 * Showing a bank account.
 *
 * The plaintext appears for forty-five seconds and then goes, on its own.
 * That is not security theatre — it does nothing an attacker cannot defeat —
 * it is about the ordinary case: a finance lead reveals an account, gets
 * called away, and the number is left on a screen in a shared office until
 * somebody notices. Long enough to copy it into the banking tab, short enough
 * that walking away closes it.
 *
 * Every press writes a row to the activity table naming who looked and which
 * event they were settling. There is no way to read one of these quietly, and
 * that is the whole design.
 */
export function Reveal({
  reveal,
  name,
  sealed,
}: {
  reveal: () => Promise<RevealResponse>
  name: string
  /** Set when the reveal path is closed — carries the reason. */
  sealed: string | null
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [shown, setShown] = useState<{ account: string; ird: string | null } | null>(null)
  const [left, setLeft] = useState(0)

  // The countdown is started by the click that reveals, not by this effect —
  // an effect that sets state on its first run cascades an extra render.
  useEffect(() => {
    if (!shown) return

    const tick = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000)
    const hide = setTimeout(() => setShown(null), HOLD_SECONDS * 1000)

    return () => {
      clearInterval(tick)
      clearTimeout(hide)
    }
  }, [shown])

  if (sealed) {
    return (
      <span className={styles.sealed} title={sealed}>
        <i className="ph ph-lock-simple" aria-hidden="true" />
        sealed
      </span>
    )
  }

  if (shown) {
    return (
      <div className={styles.revealed}>
        <code className={styles.plain}>{shown.account}</code>
        {shown.ird ? <code className={styles.plainIrd}>IRD {shown.ird}</code> : null}
        <button
          type="button"
          className={styles.hide}
          onClick={() => setShown(null)}
          title="Put it away now"
        >
          hide · {left}s
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      className={styles.revealButton}
      disabled={pending}
      title={`Reveal ${name}'s account — this is written to the event's activity`}
      onClick={() =>
        start(async () => {
          const res = await reveal()
          if (!res.ok) {
            say({ kind: 'stop', text: res.why })
            return
          }
          setLeft(HOLD_SECONDS)
          setShown({ account: res.details.account, ird: res.details.ird })
        })
      }
    >
      <i className="ph ph-eye" aria-hidden="true" />
      Reveal
    </button>
  )
}
