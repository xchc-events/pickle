import { LICENCE_STATES, type DealState, type LicenceState } from '@/lib/event-record'
import styles from './event.module.css'

/**
 * The event record's inputs, for somebody who cannot change them.
 *
 * The counterparts of Controls.tsx, drawn in their place when
 * `canChangeEventRecord` says no. Plain text, not the controls with their
 * buttons switched off: a greyed-out control still reads as a step somebody
 * could take, and for an external promoter there is no such step on this
 * page. Server components, so nothing here reaches the browser as a control.
 */

export function RunTimesReadout({
  doors,
  barClose,
  allOut,
}: {
  doors: string | null
  barClose: string | null
  allOut: string | null
}) {
  const times = [
    { label: 'Doors', value: doors },
    { label: 'Bar close', value: barClose },
    { label: 'Everyone out', value: allOut },
  ]

  return (
    <div className={styles.times}>
      {times.map((t) => (
        <div key={t.label} className={styles.timeField}>
          <span className={styles.factKey}>{t.label}</span>
          <span className={styles.factValue}>
            {t.value ?? <span className={styles.plain}>not set</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

export function LicenceReadout({ value }: { value: LicenceState }) {
  const label = LICENCE_STATES.find((s) => s.value === value)?.label ?? value

  return (
    <div className={styles.factValue}>
      <span className={value === 'denied' ? styles.stop : undefined}>{label}</span>
    </div>
  )
}

/** Where the terms stand, in the words the Terms panel uses. */
export function DealReadout({ state, note }: { state: DealState; note: string | null }) {
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
    </div>
  )
}
