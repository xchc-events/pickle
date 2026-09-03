'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import {
  LICENCE_STATES,
  DOOR_TIMES,
  CLOSE_TIMES,
  OUT_TIMES,
  type DealState,
  type LicenceState,
} from '@/lib/event-record'
import { setDateTbc, setDeal, setLicence, setRunTime } from './actions'
import styles from './event.module.css'
import type { DealState as DbDealState } from '@/generated/prisma/client'

/**
 * The event record's own inputs.
 *
 * Client components only because they carry a select or a textarea. The
 * server actions behind them re-check the module and the event scope for
 * themselves — nothing here is a permission boundary.
 */

function TimeSelect({
  eventId,
  field,
  label,
  value,
  options,
  note,
}: {
  eventId: string
  field: 'doors' | 'barClose' | 'allOut'
  label: string
  value: string | null
  options: readonly string[]
  note?: string
}) {
  const say = useToast()
  const [pending, start] = useTransition()

  return (
    <label className={styles.timeField}>
      <span className={styles.factKey}>{label}</span>
      <select
        className={styles.select}
        defaultValue={value ?? ''}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value
          start(async () => say(await setRunTime(eventId, field, next)))
        }}
      >
        <option value="">not set</option>
        {options.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {note ? <span className={styles.factNote}>{note}</span> : null}
    </label>
  )
}

export function RunTimes({
  eventId,
  doors,
  barClose,
  allOut,
  late,
}: {
  eventId: string
  doors: string | null
  barClose: string | null
  allOut: string | null
  late: boolean
}) {
  return (
    <div className={styles.times}>
      <TimeSelect
        eventId={eventId}
        field="doors"
        label="Doors"
        value={doors}
        options={DOOR_TIMES}
        note="every shift offsets from here"
      />
      <TimeSelect
        eventId={eventId}
        field="barClose"
        label="Bar close"
        value={barClose}
        options={CLOSE_TIMES}
        note={late ? 'past midnight — needs a special licence' : 'within the standard licence'}
      />
      <TimeSelect
        eventId={eventId}
        field="allOut"
        label="Everyone out"
        value={allOut}
        options={OUT_TIMES}
        note="clean-up works back from it"
      />
    </div>
  )
}

export function LicencePicker({
  eventId,
  value,
  late,
}: {
  eventId: string
  value: LicenceState
  late: boolean
}) {
  const say = useToast()
  const [pending, start] = useTransition()

  return (
    <div className={styles.chips}>
      {LICENCE_STATES.map((s) => (
        <button
          key={s.value}
          type="button"
          disabled={pending}
          className={`${styles.chip} ${value === s.value ? styles.chipOn : ''} ${
            s.value === 'denied' && value === 'denied' ? styles.chipStop : ''
          }`}
          onClick={() => start(async () => say(await setLicence(eventId, s.value)))}
        >
          {s.label}
        </button>
      ))}
      {late && value === 'not_required' ? (
        <span className={styles.warn}>
          the bar runs past midnight — this cannot stay &ldquo;not required&rdquo;
        </span>
      ) : null}
    </div>
  )
}

/**
 * Where the terms stand with the promoter.
 *
 * A query needs their words. The action refuses an empty one, and this keeps
 * the textarea rather than clearing it, so the coordinator does not lose what
 * they had typed when the toast comes back.
 */
export function DealPanel({
  eventId,
  state,
  note,
}: {
  eventId: string
  state: DealState
  note: string | null
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [draft, setDraft] = useState(note ?? '')

  // The panel speaks the domain's lower-case vocabulary; the column is an
  // upper-case Prisma enum. The mapping happens here rather than leaking the
  // database's casing into every caller.
  const run = (next: DealState) =>
    start(async () => {
      const result = await setDeal(eventId, next.toUpperCase() as DbDealState, draft)
      say(result)
      if (result.kind === 'good' && next !== 'queried') setDraft('')
    })

  return (
    <div className={styles.deal}>
      <div className={styles.dealHead}>
        <span className={styles.factKey}>Terms</span>
        <span
          className={
            state === 'agreed' ? styles.good : state === 'queried' ? styles.warn : styles.plain
          }
        >
          {state === 'agreed' ? 'agreed' : state === 'queried' ? 'queried' : 'sent, waiting'}
        </span>
      </div>

      {state === 'queried' && note ? <p className={styles.dealNote}>&ldquo;{note}&rdquo;</p> : null}

      <textarea
        className={styles.textarea}
        value={draft}
        placeholder="What did they say? Needed to record a query."
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
      />

      <div className={styles.dealActions}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() => run('agreed')}
        >
          They agreed
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() => run('queried')}
        >
          They queried it
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pending}
          onClick={() => run('sent')}
        >
          Put it back to them
        </button>
      </div>
    </div>
  )
}

/**
 * Whether the date is held or still a best guess.
 *
 * Lives on this page because the "Date is locked" gate sends the coordinator
 * here to fix it — a gate whose Fix it link lands on a screen with no control
 * is a dead end.
 */
export function DateLock({ eventId, tbc }: { eventId: string; tbc: boolean }) {
  const say = useToast()
  const [pending, start] = useTransition()

  return (
    <button
      type="button"
      className={`${styles.chip} ${tbc ? styles.chipOn : ''}`}
      disabled={pending}
      onClick={() => start(async () => say(await setDateTbc(eventId, !tbc)))}
    >
      {tbc ? 'Lock this date' : 'Put the date back to TBC'}
    </button>
  )
}
