'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import { money } from '@/lib/format'
import { countDoor } from './actions'
import styles from './event.module.css'

/**
 * Reconciling the night, from the event record.
 *
 * Only the door is counted here. The bar is closed in Bar, off the till, by
 * whoever holds the till read — the bar manager, who has no Pipeline
 * permission. This panel shows the bar half so a coordinator can see what the
 * settlement reads, and says where it is closed; it never edits it, so the two
 * halves keep one writer each.
 *
 * The GST terms are stated on each field rather than left to a convention.
 * Getting them wrong moves the settlement silently, and the person it moves
 * against is standing there.
 */
export function Actuals({
  eventId,
  door,
  bar,
  barHref,
}: {
  eventId: string
  door: { tickets: number; ticketRev: number } | null
  bar: { barTake: number; barProfit: number } | null
  /** Where the bar is closed, or null when this user cannot open Bar. */
  barHref: string | null
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [v, setV] = useState({
    tickets: door?.tickets?.toString() ?? '',
    ticketRev: door?.ticketRev?.toString() ?? '',
  })

  // An empty box is not a zero. Sending NaN lets the server refuse it in
  // words, rather than recording a night nobody came to.
  const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s))

  const field = (key: keyof typeof v, label: string, note: string, isMoney?: boolean) => (
    <label className={styles.actualField} key={key}>
      <span className={styles.factKey}>{label}</span>
      <span className={styles.actualInputWrap}>
        {isMoney && <span className={styles.actualPrefix}>$</span>}
        <input
          className={styles.actualInput}
          type="number"
          min="0"
          step={isMoney ? '0.01' : '1'}
          inputMode="decimal"
          value={v[key]}
          disabled={pending}
          onChange={(e) => setV({ ...v, [key]: e.target.value })}
        />
      </span>
      <span className={styles.actualNote}>{note}</span>
    </label>
  )

  return (
    <div className={styles.actuals}>
      <div className={styles.actualHalf}>
        <span className={styles.actualHalfTitle}>
          <i className={`ph ${door ? 'ph-check-circle' : 'ph-circle-dashed'}`} aria-hidden="true" />
          The door
          <span className={styles.actualHalfState}>{door ? 'in' : 'not in yet'}</span>
        </span>

        <div className={styles.actualGrid}>
          {field('tickets', 'People in', 'counted on the door, not tickets sold')}
          {field('ticketRev', 'Ticket takings', 'GST included — what was actually taken', true)}
        </div>

        <button
          type="button"
          className={styles.actualSave}
          disabled={pending}
          onClick={() =>
            start(async () =>
              say(
                await countDoor(eventId, { tickets: num(v.tickets), ticketRev: num(v.ticketRev) }),
              ),
            )
          }
        >
          {door ? 'Update the door count' : 'Count the door'}
        </button>
      </div>

      <div className={styles.actualHalf}>
        <span className={styles.actualHalfTitle}>
          <i className={`ph ${bar ? 'ph-check-circle' : 'ph-circle-dashed'}`} aria-hidden="true" />
          The bar
          <span className={styles.actualHalfState}>{bar ? 'in' : 'not in yet'}</span>
        </span>
        <p className={styles.actualBar}>
          {bar
            ? `${money(bar.barTake)} over the bar, ${money(bar.barProfit)} after stock. `
            : 'Closed in Bar, off the till, by whoever holds the till read. Until then the settlement keeps the modelled bar margin. '}
          {barHref ? (
            <Link href={barHref} className={styles.actualBarLink}>
              {bar ? 'See it in Bar' : 'Close it in Bar'}
            </Link>
          ) : null}
        </p>
      </div>
    </div>
  )
}
