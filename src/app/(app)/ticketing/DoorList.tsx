'use client'

import { useRef, useTransition } from 'react'
import Link from 'next/link'
import type { Said } from '@/lib/toast'
import { useToast } from '@/components/Toast'
import { ActionButton } from '@/components/ActionButton'
import { SectionHeading } from '@/components/SectionHeading'
import type { DoorListSection } from '@/lib/ticketing-data'
import styles from './DoorList.module.css'

const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: 'GUEST', label: 'Guest' },
  { value: 'COMP', label: 'Comp' },
  { value: 'INDUSTRY', label: 'Industry' },
  { value: 'ACT', label: 'Act' },
]

/**
 * T7 — the door's own guest list, grouped by kind.
 *
 * Venue only, the same as Codes: `page.tsx` does not mount this for an
 * external account, and `add`/`remove` refuse independently.
 */
export function DoorList({
  eventId,
  doorList,
  add,
  remove,
}: {
  eventId: string
  doorList: DoorListSection
  add: (form: FormData) => Promise<Said>
  remove: (entryId: string) => Promise<Said>
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <div>
      <SectionHeading note={`${doorList.totalPeople} people`}>Door list</SectionHeading>
      <p className={styles.note}>
        {doorList.compsFromList
          ? 'The comps line on the settlement reads the COMP entries below, not the crew figure typed on the event record.'
          : 'No comp entries yet — the settlement still reads the crew figure typed on the event record.'}{' '}
        <Link href={`/ticketing/door-list?event=${eventId}`} className={styles.printLink}>
          Open the print view for the door
        </Link>
      </p>

      {doorList.groups.length ? (
        <div className={styles.groups}>
          {doorList.groups.map((g) => (
            <div key={g.kind} className={styles.group}>
              <div className={styles.groupHead}>
                <span className={styles.groupLabel}>{g.label}</span>
                <span className={styles.groupCount}>{g.people}</span>
              </div>
              <ul className={styles.list}>
                {g.rows.map((r) => (
                  <li key={r.id} className={styles.row}>
                    <span className={styles.name}>{r.name}</span>
                    <span className={styles.party}>×{r.partySize}</span>
                    <span className={styles.entryNote}>{r.note ?? ''}</span>
                    <span className={styles.who}>{r.who}</span>
                    <ActionButton className="btn btn-ghost" action={remove.bind(null, r.id)}>
                      Remove
                    </ActionButton>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>No one on the list yet.</p>
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
            if (said.kind !== 'stop') formRef.current?.reset()
          })
        }}
      >
        <label className={styles.field}>
          Name
          <input
            className={styles.input}
            name="name"
            placeholder="Ari Tāne"
            maxLength={120}
            disabled={pending}
            required
          />
        </label>

        <label className={styles.fieldNarrow}>
          Party
          <input
            className={styles.inputNarrow}
            name="partySize"
            type="number"
            min="1"
            step="1"
            defaultValue={1}
            disabled={pending}
            required
          />
        </label>

        <label className={styles.field}>
          Kind
          <select className={styles.input} name="kind" defaultValue="GUEST" disabled={pending}>
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.fieldWide}>
          Note
          <input
            className={styles.input}
            name="note"
            placeholder="optional"
            maxLength={200}
            disabled={pending}
          />
        </label>

        <button type="submit" className={`btn btn-primary ${styles.submit}`} disabled={pending}>
          Add to list
        </button>
      </form>
    </div>
  )
}
