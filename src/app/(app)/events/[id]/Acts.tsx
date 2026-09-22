'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import { BILL_STATUSES, FEE_STEP, actLockedBecause, tidyName } from '@/lib/terms'
import {
  addAct,
  issueArtistLink,
  linkArtistToPayee,
  removeAct,
  renameAct,
  setActFees,
  setActStatus,
} from './actions'
import { ArtistLink } from './ArtistLink'
import styles from './event.module.css'

/**
 * The bill, editable. Only for whoever can change the record, and only
 * before the night is put to bed — page.tsx decides that, this just draws
 * the row once it has been asked to.
 *
 * Each row keys itself off every saved field (`ActsEditor` below), so a
 * successful save — this row's own, or anyone else's touching the same event
 * — remounts it with a fresh draft instead of an effect reaching back to
 * resync state that was never this component's to own.
 */

interface Act {
  id: string
  name: string
  status: string
  low: number
  high: number
  paid: boolean
  payeeName: string | null
  files: { kind: string; label: string; icon: string; have: boolean }[]
}

function ActRow({ eventId, act }: { eventId: string; act: Act }) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [name, setName] = useState(act.name)
  const [low, setLow] = useState(act.low)
  const [high, setHigh] = useState(act.high)

  const lockedWhy = actLockedBecause(act)
  const locked = pending || lockedWhy !== null
  const title = lockedWhy ?? undefined

  // Blur and Enter both land here. Guarded on `pending` because disabling
  // the input mid-save (React reacting to the transition) blurs it too —
  // without the guard that second, synthetic blur would tidy and re-send
  // the same rename a second time before the row has a chance to remount.
  const commitName = () => {
    if (pending) return
    const tidied = tidyName(name)
    setName(tidied)
    if (tidied === act.name) return
    start(async () => say(await renameAct(eventId, act.id, tidied)))
  }

  return (
    <li className={styles.artist}>
      <div className={styles.artistMain}>
        <input
          className={`${styles.select} ${styles.nameInput}`}
          aria-label={`${act.name}'s name`}
          value={name}
          disabled={locked}
          title={title}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitName()
            } else if (e.key === 'Escape') {
              setName(act.name)
            }
          }}
        />

        <select
          className={`${styles.select} ${styles.statusSelect}`}
          aria-label={`${act.name}'s status`}
          defaultValue={act.status}
          disabled={locked}
          title={title}
          onChange={(e) =>
            start(async () => say(await setActStatus(eventId, act.id, e.target.value)))
          }
        >
          {BILL_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <span className={styles.feeGroup}>
          <input
            type="number"
            className={`${styles.select} ${styles.feeInput}`}
            aria-label={`${act.name}'s fee floor`}
            step={FEE_STEP}
            min={0}
            value={low}
            disabled={locked}
            title={title}
            onChange={(e) => setLow(Number(e.target.value))}
          />
          <span aria-hidden="true">–</span>
          <input
            type="number"
            className={`${styles.select} ${styles.feeInput}`}
            aria-label={`${act.name}'s fee ceiling`}
            step={FEE_STEP}
            min={0}
            value={high}
            disabled={locked}
            title={title}
            onChange={(e) => setHigh(Number(e.target.value))}
          />
          <button
            type="button"
            className={styles.smallBtn}
            aria-label={`Set ${act.name}'s fee range`}
            disabled={locked || (low === act.low && high === act.high)}
            title={title}
            onClick={() => start(async () => say(await setActFees(eventId, act.id, low, high)))}
          >
            Set
          </button>
        </span>

        {act.payeeName ? null : (
          <span className={styles.unlinked} title="No payee record — they cannot be paid yet">
            not linked
          </span>
        )}

        {/* Moved from Tech production 23 Sep 2026 — bank details and the
            payee link are the coordinator's business, on the row that
            already carries everything else about the act. */}
        <ArtistLink
          hasPayee={act.payeeName !== null}
          issue={issueArtistLink.bind(null, eventId, act.id)}
          link={linkArtistToPayee.bind(null, eventId, act.id)}
        />

        <button
          type="button"
          className={styles.removeBtn}
          aria-label={`Remove ${act.name}`}
          disabled={locked}
          title={title}
          onClick={() => {
            if (window.confirm(`Take ${act.name} off the bill?`)) {
              start(async () => say(await removeAct(eventId, act.id)))
            }
          }}
        >
          <i className="ph ph-x" aria-hidden="true" />
        </button>
      </div>

      <div className={styles.artistFiles}>
        {act.files.map((f) => (
          <span
            key={f.kind}
            className={`${styles.file} ${f.have ? styles.fileHave : ''}`}
            title={f.have ? `${f.label} on file` : `${f.label} not in yet`}
          >
            <i className={`ph ${f.have ? 'ph-check' : 'ph-circle-dashed'}`} aria-hidden="true" />
            {f.label}
          </span>
        ))}
      </div>
    </li>
  )
}

function AddActForm({ eventId }: { eventId: string }) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [name, setName] = useState('')

  const submit = () => {
    const tidied = tidyName(name)
    start(async () => {
      const result = await addAct(eventId, tidied)
      say(result)
      if (result.kind === 'good') setName('')
    })
  }

  return (
    <div className={styles.addAct}>
      <input
        className={`${styles.select} ${styles.nameInput}`}
        aria-label="New act's name"
        placeholder="Add an act"
        value={name}
        disabled={pending}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
      />
      <button type="button" className={styles.smallBtn} disabled={pending} onClick={submit}>
        Add
      </button>
    </div>
  )
}

export function ActsEditor({ eventId, acts }: { eventId: string; acts: Act[] }) {
  return (
    <>
      {acts.length === 0 ? (
        <p className={styles.none}>Nobody on the bill yet.</p>
      ) : (
        <ul className={styles.artists}>
          {acts.map((a) => (
            <ActRow
              // Every saved field, not just the id — a successful save
              // remounts this row with the new value as its fresh starting
              // draft, which is the resync this list needs.
              key={`${a.id}:${a.name}:${a.status}:${a.low}:${a.high}:${a.paid}`}
              eventId={eventId}
              act={a}
            />
          ))}
        </ul>
      )}
      <AddActForm eventId={eventId} />
    </>
  )
}
