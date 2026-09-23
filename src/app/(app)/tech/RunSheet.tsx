'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import type { Said } from '@/lib/toast'
import { dateLabel } from '@/lib/format'
import { clockFromInput, clockToInput } from '@/lib/run-times'
import type { RunSheetRow } from '@/lib/run-sheet'
import type { EventRecipient } from '@/lib/tech-data'
import type { RunSheetSendSummary } from '@/lib/run-sheet-data'
import styles from './tech.module.css'

interface EditableRow {
  key: string
  time: string
  item: string
  who: string
  note: string
}

let nextKey = 0
const freshKey = () => `new-${++nextKey}`

const fromServer = (rows: readonly RunSheetRow[]): EditableRow[] =>
  rows.map((r, i) => ({
    key: r.id ?? `seed-${i}`,
    time: r.time ?? '',
    item: r.item,
    who: r.who ?? '',
    note: r.note ?? '',
  }))

const move = <T,>(rows: readonly T[], from: number, to: number): T[] => {
  if (to < 0 || to >= rows.length) return [...rows]
  const next = [...rows]
  const [row] = next.splice(from, 1)
  next.splice(to, 0, row!)
  return next
}

/**
 * The tech run sheet: rows editable in place, add, remove, reorder, then
 * "Send to the promoter".
 *
 * Connor, 23 Sep 2026: "A section here which allows you to fill in a run
 * sheet, like a tech run sheet, would be really helpful. And then sending
 * that to the promoter." A new event's rows come in already seeded from its
 * own times (`seedRunSheetRows` in src/lib/run-sheet.ts, via `runSheetFor`)
 * — this component does not know or care whether a row it is showing has
 * been saved before; `save` replaces the whole sheet either way.
 */
export function RunSheet({
  rows: initialRows,
  recipients,
  latestSend,
  save,
  send,
}: {
  rows: readonly RunSheetRow[]
  recipients: EventRecipient[]
  latestSend: RunSheetSendSummary | null
  save: (
    rows: { time: string | null; item: string; who: string | null; note: string | null }[],
  ) => Promise<Said>
  send: (actPayeeIds: string[]) => Promise<Said>
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [rows, setRows] = useState<EditableRow[]>(() => fromServer(initialRows))
  const [chosenActs, setChosenActs] = useState<ReadonlySet<string>>(() => new Set())

  const promoter = recipients.find((r) => r.kind === 'promoter')
  const acts = recipients.filter((r) => r.kind === 'act')

  const update = (key: string, patch: Partial<EditableRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const addRow = () =>
    setRows((rs) => [...rs, { key: freshKey(), time: '', item: '', who: '', note: '' }])

  const removeRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key))

  const moveRow = (index: number, delta: number) => setRows((rs) => move(rs, index, index + delta))

  const doSave = () =>
    start(async () => {
      const cleaned = rows.map((r) => ({
        time: clockFromInput(r.time),
        item: r.item,
        who: r.who.trim() || null,
        note: r.note.trim() || null,
      }))
      say(await save(cleaned))
    })

  return (
    <div className={styles.runSheet}>
      <p className={latestSend ? styles.good : styles.quiet}>
        <i
          className={`ph ${latestSend ? 'ph-check-circle' : 'ph-circle-dashed'}`}
          aria-hidden="true"
        />
        {latestSend
          ? `sent to ${latestSend.recipientNames.join(', ')} on ${dateLabel(latestSend.sentAt)}${latestSend.sentByName ? ` by ${latestSend.sentByName}` : ''}`
          : 'not sent yet'}
      </p>

      <div className={styles.runRows}>
        <div className={styles.runHead} aria-hidden="true">
          <span>Time</span>
          <span>Item</span>
          <span>Who</span>
          <span>Note</span>
          <span />
        </div>
        {rows.map((r, i) => (
          <div key={r.key} className={styles.runRow}>
            <input
              type="time"
              className={styles.runTime}
              value={r.time ? clockToInput(r.time) : ''}
              disabled={pending}
              onChange={(e) => update(r.key, { time: clockFromInput(e.target.value) ?? '' })}
            />
            <input
              className={styles.runField}
              placeholder="e.g. Doors"
              value={r.item}
              disabled={pending}
              onChange={(e) => update(r.key, { item: e.target.value })}
            />
            <input
              className={styles.runField}
              placeholder="who"
              value={r.who}
              disabled={pending}
              onChange={(e) => update(r.key, { who: e.target.value })}
            />
            <input
              className={styles.runField}
              placeholder="note"
              value={r.note}
              disabled={pending}
              onChange={(e) => update(r.key, { note: e.target.value })}
            />
            <span className={styles.runRowActions}>
              <button
                type="button"
                className={styles.runIconButton}
                disabled={pending || i === 0}
                title="Move up"
                onClick={() => moveRow(i, -1)}
              >
                <i className="ph ph-arrow-up" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.runIconButton}
                disabled={pending || i === rows.length - 1}
                title="Move down"
                onClick={() => moveRow(i, 1)}
              >
                <i className="ph ph-arrow-down" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={styles.runIconButton}
                disabled={pending}
                title="Remove this row"
                onClick={() => removeRow(r.key)}
              >
                <i className="ph ph-trash" aria-hidden="true" />
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className={styles.runActions}>
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={addRow}>
          <i className="ph ph-plus" aria-hidden="true" />
          Add a row
        </button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={doSave}>
          Save run sheet
        </button>
      </div>

      <div className={styles.runSend}>
        {promoter === undefined ? (
          <p className={styles.none}>No promoter payee on this event to send it to.</p>
        ) : (
          <>
            <fieldset className={styles.specFieldset} disabled={pending}>
              <legend>
                Send to {promoter.name}
                {promoter.email ? '' : ' — no email on file'}, and
              </legend>
              {acts.length === 0 ? (
                <p className={styles.none}>No other act with an email on this event yet.</p>
              ) : (
                acts.map((a) => (
                  <label
                    key={a.payeeId}
                    className={styles.specCheck}
                    title={a.email ?? 'No email on file'}
                  >
                    <input
                      type="checkbox"
                      checked={chosenActs.has(a.payeeId)}
                      disabled={!a.email}
                      onChange={() =>
                        setChosenActs((cs) => {
                          const next = new Set(cs)
                          if (next.has(a.payeeId)) next.delete(a.payeeId)
                          else next.add(a.payeeId)
                          return next
                        })
                      }
                    />
                    {a.name}
                    {!a.email ? <span className={styles.noEmail}>no email on file</span> : null}
                  </label>
                ))
              )}
            </fieldset>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || !promoter.email}
              onClick={() => start(async () => say(await send([...chosenActs])))}
            >
              Send to the promoter
            </button>
          </>
        )}
      </div>
    </div>
  )
}
