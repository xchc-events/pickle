'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import { reconcileActuals } from './actions'
import styles from './event.module.css'

/**
 * Reconciling the night.
 *
 * The last thing that happens to an event, and until now the one thing it
 * could not do: `hasActual` gated Show week → Payout and no screen could write
 * the row, so a real booking could never settle.
 *
 * The GST terms are stated on each field rather than left to a convention.
 * Door and bar takings are what was rung up, GST included; bar profit is
 * already a margin and is not. Getting that wrong moves the settlement
 * silently, and the person it moves against is standing there.
 */
export function Actuals({
  eventId,
  initial,
}: {
  eventId: string
  initial: { tickets: number; ticketRev: number; barTake: number; barProfit: number } | null
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [v, setV] = useState({
    tickets: initial?.tickets?.toString() ?? '',
    ticketRev: initial?.ticketRev?.toString() ?? '',
    barTake: initial?.barTake?.toString() ?? '',
    barProfit: initial?.barProfit?.toString() ?? '',
  })

  const field = (key: keyof typeof v, label: string, note: string, prefix?: string) => (
    <label className={styles.actualField} key={key}>
      <span className={styles.factKey}>{label}</span>
      <span className={styles.actualInputWrap}>
        {prefix && <span className={styles.actualPrefix}>{prefix}</span>}
        <input
          className={styles.actualInput}
          type="number"
          min="0"
          step={key === 'tickets' ? '1' : '0.01'}
          inputMode="decimal"
          value={v[key]}
          disabled={pending}
          onChange={(e) => setV({ ...v, [key]: e.target.value })}
        />
      </span>
      <span className={styles.actualNote}>{note}</span>
    </label>
  )

  const num = (s: string) => (s.trim() === '' ? 0 : Number(s))

  return (
    <div className={styles.actuals}>
      <div className={styles.actualGrid}>
        {field('tickets', 'People in', 'counted on the door, not tickets sold')}
        {field('ticketRev', 'Door takings', 'GST included — what was actually taken', '$')}
        {field('barTake', 'Bar take', 'GST included — gross over the bar', '$')}
        {field('barProfit', 'Bar profit', 'after stock, GST excluded', '$')}
      </div>

      <button
        type="button"
        className={styles.actualSave}
        disabled={pending}
        onClick={() =>
          start(async () =>
            say(
              await reconcileActuals(eventId, {
                tickets: num(v.tickets),
                ticketRev: num(v.ticketRev),
                barTake: num(v.barTake),
                barProfit: num(v.barProfit),
              }),
            ),
          )
        }
      >
        {initial ? 'Update the reconciliation' : 'Reconcile the night'}
      </button>
    </div>
  )
}
