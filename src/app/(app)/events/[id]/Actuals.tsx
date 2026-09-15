'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import type { Said } from '@/lib/toast'
import { closeBar, countDoor } from './actions'
import styles from './event.module.css'

/**
 * Reconciling the night, in its two halves.
 *
 * The door and the bar are counted by different people off different sources
 * — the door off Gather.rsvp and the door sheet, the bar off the till — so
 * each is its own form and its own write. Counting the door does not wait on
 * the bar, and closing the bar cannot overwrite a door somebody already
 * counted. The settlement reads whichever halves are in; the gate out of the
 * event waits for both.
 *
 * The GST terms are stated on each field rather than left to a convention.
 * Getting them wrong moves the settlement silently, and the person it moves
 * against is standing there.
 */
export function Actuals({
  eventId,
  door,
  bar,
}: {
  eventId: string
  door: { tickets: number; ticketRev: number } | null
  bar: { barTake: number; barProfit: number } | null
}) {
  return (
    <div className={styles.actuals}>
      <Half
        title="The door"
        fields={[
          { key: 'tickets', label: 'People in', note: 'counted on the door, not tickets sold' },
          {
            key: 'ticketRev',
            label: 'Ticket takings',
            note: 'GST included — what was actually taken',
            money: true,
          },
        ]}
        initial={door}
        saveLabel={door ? 'Update the door count' : 'Count the door'}
        save={(v) => countDoor(eventId, { tickets: v.tickets!, ticketRev: v.ticketRev! })}
      />
      <Half
        title="The bar"
        fields={[
          {
            key: 'barTake',
            label: 'Bar take',
            note: 'GST included — gross over the bar',
            money: true,
          },
          {
            key: 'barProfit',
            label: 'Bar profit',
            note: 'after stock, GST excluded',
            money: true,
          },
        ]}
        initial={bar}
        saveLabel={bar ? 'Update the bar close' : 'Close the bar'}
        save={(v) => closeBar(eventId, { barTake: v.barTake!, barProfit: v.barProfit! })}
      />
    </div>
  )
}

interface Field {
  key: string
  label: string
  note: string
  money?: boolean
}

function Half({
  title,
  fields,
  initial,
  saveLabel,
  save,
}: {
  title: string
  fields: Field[]
  initial: Record<string, number> | null
  saveLabel: string
  save: (values: Record<string, number>) => Promise<Said>
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [v, setV] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, initial?.[f.key]?.toString() ?? ''])),
  )

  // An empty box is not a zero. Sending NaN lets the server refuse it in
  // words, rather than recording a night that took nothing.
  const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s))

  return (
    <div className={styles.actualHalf}>
      <span className={styles.actualHalfTitle}>
        <i
          className={`ph ${initial ? 'ph-check-circle' : 'ph-circle-dashed'}`}
          aria-hidden="true"
        />
        {title}
        <span className={styles.actualHalfState}>{initial ? 'in' : 'not in yet'}</span>
      </span>

      <div className={styles.actualGrid}>
        {fields.map((f) => (
          <label className={styles.actualField} key={f.key}>
            <span className={styles.factKey}>{f.label}</span>
            <span className={styles.actualInputWrap}>
              {f.money && <span className={styles.actualPrefix}>$</span>}
              <input
                className={styles.actualInput}
                type="number"
                min="0"
                step={f.money ? '0.01' : '1'}
                inputMode="decimal"
                value={v[f.key]}
                disabled={pending}
                onChange={(e) => setV({ ...v, [f.key]: e.target.value })}
              />
            </span>
            <span className={styles.actualNote}>{f.note}</span>
          </label>
        ))}
      </div>

      <button
        type="button"
        className={styles.actualSave}
        disabled={pending}
        onClick={() =>
          start(async () =>
            say(await save(Object.fromEntries(fields.map((f) => [f.key, num(v[f.key] ?? '')])))),
          )
        }
      >
        {saveLabel}
      </button>
    </div>
  )
}
