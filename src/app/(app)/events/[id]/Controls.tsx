'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import { LICENCE_STATES, type DealState, type LicenceState } from '@/lib/event-record'
import { nightInput } from '@/lib/night'
import { clockToInput } from '@/lib/run-times'
import { setDateTbc, setDeal, setEndDate, setLicence, setRunTime } from './actions'
import styles from './event.module.css'
import type { DealState as DbDealState } from '@/generated/prisma/client'

/**
 * The event record's own inputs.
 *
 * Client components only because they carry a select or a textarea. The
 * server actions behind them re-check the module and the event scope for
 * themselves — nothing here is a permission boundary.
 */

function TimeField({
  eventId,
  field,
  label,
  value,
  note,
}: {
  eventId: string
  field: 'doors' | 'barClose' | 'allOut'
  label: string
  value: string | null
  note?: string
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [draft, setDraft] = useState(() => clockToInput(value))

  // Committed on blur, not on every tick of the native picker — the same
  // guard as Acts.tsx's commitName: disabling the field mid-save (React
  // reacting to the transition) blurs it too, and without the `pending`
  // check that synthetic blur would resend the same value a second time.
  const commit = () => {
    if (pending) return
    if (draft === clockToInput(value)) return
    start(async () => say(await setRunTime(eventId, field, draft)))
  }

  return (
    <label className={styles.timeField}>
      <span className={styles.factKey}>{label}</span>
      <input
        type="time"
        className={styles.select}
        value={draft}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
      {note ? <span className={styles.factNote}>{note}</span> : null}
    </label>
  )
}

function EndsField({ eventId, value }: { eventId: string; value: Date | null }) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [draft, setDraft] = useState(() => (value ? nightInput(value) : ''))

  const commit = () => {
    if (pending) return
    const saved = value ? nightInput(value) : ''
    if (draft === saved) return
    start(async () => say(await setEndDate(eventId, draft)))
  }

  return (
    <label className={styles.timeField}>
      <span className={styles.factKey}>Ends</span>
      <input
        type="date"
        className={styles.select}
        value={draft}
        disabled={pending}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
      <span className={styles.factNote}>blank infers it from doors and everyone out</span>
    </label>
  )
}

export function RunTimes({
  eventId,
  doors,
  barClose,
  allOut,
  endDate,
  late,
}: {
  eventId: string
  doors: string | null
  barClose: string | null
  allOut: string | null
  endDate: Date | null
  late: boolean
}) {
  return (
    <div className={styles.times}>
      <TimeField
        eventId={eventId}
        field="doors"
        label="Doors"
        value={doors}
        note="every shift offsets from here"
      />
      <TimeField
        eventId={eventId}
        field="barClose"
        label="Bar close"
        value={barClose}
        note={late ? 'past midnight — needs a special licence' : 'within the standard licence'}
      />
      <EndsField eventId={eventId} value={endDate} />
      <TimeField
        eventId={eventId}
        field="allOut"
        label="Everyone out"
        value={allOut}
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
