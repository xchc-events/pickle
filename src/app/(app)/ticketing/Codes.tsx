'use client'

import { useRef, useState, useTransition } from 'react'
import type { Said } from '@/lib/toast'
import { useToast } from '@/components/Toast'
import { ActionButton } from '@/components/ActionButton'
import { SectionHeading } from '@/components/SectionHeading'
import type { TicketCodeRow } from '@/lib/ticketing-data'
import styles from './Codes.module.css'

const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: 'PERCENT_OFF', label: 'Percent off' },
  { value: 'AMOUNT_OFF', label: 'Amount off' },
  { value: 'FREE', label: 'Free ticket' },
  { value: 'UNLOCKS_TIER', label: 'Unlocks a tier' },
]

const TIER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Any tier' },
  { value: 'sub', label: 'Subsidised' },
  { value: 'std', label: 'Standard' },
  { value: 'sup', label: 'Supporter' },
  { value: 'door', label: 'Door' },
]

/**
 * T6 — discount, free and tier-access codes.
 *
 * Venue only: `page.tsx` does not mount this at all for an external
 * account, and `add`/`deactivate` refuse independently, the same as every
 * other server-side gate in this product.
 */
export function Codes({
  codes,
  add,
  deactivate,
}: {
  codes: TicketCodeRow[]
  add: (form: FormData) => Promise<Said>
  deactivate: (codeId: string) => Promise<Said>
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [kind, setKind] = useState('PERCENT_OFF')
  const formRef = useRef<HTMLFormElement>(null)

  const needsValue = kind === 'PERCENT_OFF' || kind === 'AMOUNT_OFF'

  return (
    <div>
      <SectionHeading note={`${codes.length} on this event`}>Codes</SectionHeading>
      <p className={styles.note}>
        Send a code to a guest, an act or the door — a percent or dollar discount, a free ticket, or
        one that unlocks a tier that is not otherwise on sale. A code changes nothing in the
        projection above until Gather.rsvp reports a redemption against it.
      </p>

      {codes.length ? (
        <ul className={styles.list}>
          {codes.map((c) => (
            <li key={c.id} className={styles.row}>
              <span className={styles.code}>{c.code}</span>
              <span className={styles.value}>{c.valueLabel}</span>
              <span className={styles.tier}>{c.tierKey ?? 'any tier'}</span>
              <span className={`${styles.state} ${styles[c.state]}`}>{c.stateLabel}</span>
              <span className={styles.uses}>
                {c.uses}
                {c.useLimit !== null ? ` of ${c.useLimit}` : ''} used
              </span>
              <span className={styles.who}>
                {c.who} · {c.whenLabel}
              </span>
              {c.state === 'off' ? (
                <span className={styles.doneNote}>off</span>
              ) : (
                <ActionButton className="btn btn-ghost" action={deactivate.bind(null, c.id)}>
                  Deactivate
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No codes yet.</p>
      )}

      <form
        ref={formRef}
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          const form = new FormData(e.currentTarget)
          start(async () => {
            const said = await add(form)
            say(said)
            if (said.kind !== 'stop') {
              formRef.current?.reset()
              setKind('PERCENT_OFF')
            }
          })
        }}
      >
        <label className={styles.field}>
          Code
          <input
            className={styles.input}
            name="code"
            placeholder="LOCALS"
            maxLength={40}
            disabled={pending}
            required
          />
        </label>

        <label className={styles.field}>
          Kind
          <select
            className={styles.input}
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            disabled={pending}
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>

        {needsValue ? (
          <label className={styles.field}>
            {kind === 'PERCENT_OFF' ? 'Percent' : 'Amount ($)'}
            <input
              className={styles.input}
              name="value"
              type="number"
              min="0"
              step="any"
              disabled={pending}
              required
            />
          </label>
        ) : null}

        <label className={styles.field}>
          Tier
          <select className={styles.input} name="tierKey" disabled={pending}>
            {TIER_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          Use limit
          <input
            className={styles.input}
            name="useLimit"
            type="number"
            min="1"
            step="1"
            placeholder="unlimited"
            disabled={pending}
          />
        </label>

        <label className={styles.field}>
          Active from
          <input className={styles.input} name="activeFrom" type="date" disabled={pending} />
        </label>

        <label className={styles.field}>
          Active to
          <input className={styles.input} name="activeTo" type="date" disabled={pending} />
        </label>

        <button type="submit" className={`btn btn-primary ${styles.submit}`} disabled={pending}>
          Add code
        </button>
      </form>
    </div>
  )
}
