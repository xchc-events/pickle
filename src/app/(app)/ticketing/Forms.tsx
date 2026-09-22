'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import { mixProblem, tierTable } from '@/lib/ticketing'
import { money } from '@/lib/format'
import type { Said } from '@/lib/toast'
import styles from './ticketing.module.css'

/** FormData field names, in the fixed sub/std/sup/door row order. */
const SHARE_NAMES = ['subShare', 'stdShare', 'supShare', 'doorShare'] as const

/**
 * Prices and mix, folded into one table.
 *
 * "It needs to be clearer that if I change these numbers, that is going to
 * change this data" — so the price and the share live on the row they change,
 * not in a form underneath it. Standard and door are typed; subsidised and
 * supporter are derived and redraw on every keystroke, using the same
 * `tierTable` the saved page reads, so what this shows while you type is
 * never a different sum from what Save commits. One Save for both, because
 * they are one decision now.
 */
export function TiersTable({
  std,
  door,
  mix,
  save,
}: {
  std: number
  door: number
  mix: number[]
  save: (form: FormData) => Promise<Said>
}) {
  const say = useToast()
  const [pending, start] = useTransition()

  const [stdVal, setStdVal] = useState(String(std))
  const [doorVal, setDoorVal] = useState(String(door))
  const [shares, setShares] = useState(mix.map((n) => Math.round(n * 100)))

  const stdNum = Number(stdVal)
  const doorNum = Number(doorVal)
  const rows = tierTable(
    Number.isFinite(stdNum) ? stdNum : 0,
    Number.isFinite(doorNum) ? doorNum : 0,
    shares.map((n) => n / 100),
  )

  const total = shares.reduce((a, b) => a + b, 0)
  const problem = mixProblem(shares.map((n) => n / 100))

  return (
    <form className={styles.tiersForm} action={(f) => start(async () => say(await save(f)))}>
      {problem ? (
        <p className={styles.mixWarn}>
          <i className="ph ph-warning" aria-hidden="true" />
          {problem}
        </p>
      ) : null}

      <ul className={styles.tiers}>
        {rows.map((r, i) => (
          <li key={r.key} className={styles.tier}>
            <span className={styles.tierLabel}>{r.label}</span>

            {r.key === 'std' || r.key === 'door' ? (
              <input
                name={r.key}
                type="number"
                min="0"
                max="500"
                step="1"
                value={r.key === 'std' ? stdVal : doorVal}
                onChange={(e) =>
                  r.key === 'std' ? setStdVal(e.target.value) : setDoorVal(e.target.value)
                }
                className={`${styles.input} tabular`}
              />
            ) : (
              <span className={`${styles.tierPrice} tabular`} title="Derived from standard">
                {money(r.price)}
              </span>
            )}

            <label className={styles.tierShare}>
              <input
                name={SHARE_NAMES[i]}
                type="number"
                min="0"
                max="100"
                step="1"
                value={shares[i]}
                onChange={(e) =>
                  setShares((prev) => prev.map((p, j) => (j === i ? Number(e.target.value) : p)))
                }
                className={styles.shareInput}
              />
              <span>% of the room</span>
            </label>

            <span className={`${styles.tierContributes} tabular`}>
              {money(r.price * (shares[i] / 100))} of the average
            </span>
          </li>
        ))}
      </ul>

      <div className={styles.tiersFoot}>
        <button type="submit" className={styles.submit} disabled={pending || problem !== null}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <p className={`${styles.formNote} ${problem ? styles.stop : total === 100 ? styles.good : ''}`}>
          {problem ?? `${total}% — that makes a whole. Supporter and subsidised move with standard.`}
        </p>
      </div>
    </form>
  )
}
