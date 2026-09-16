import Link from 'next/link'
import type { EventRecord } from '@/lib/event-record-data'
import styles from './event.module.css'

/**
 * Where each part of the event stands — the load-bearing panel on this page.
 *
 * Each of the eight parts carries its own status, worked out from the records
 * its own module keeps, and every gate is listed under the part it belongs to.
 * A coordinator reads what holds each part up without any part waiting on
 * another: tickets can be on sale while the artwork is still being argued
 * over, and a promoter's artwork can be in while the booking is an enquiry.
 *
 * A part's clear gates are counted rather than listed; the ones still failing
 * say why, and link to the screen that fixes them. They fold away under the
 * part's row, so eight parts stay eight rows — open by default only where
 * something is asked of the reader: the part the header button moves, and
 * any part that wants attention or is blocked. The booking and putting a
 * night to bed are the two moves a person still makes by hand, and the line
 * under whichever is next says what the button is waiting on.
 *
 * A promoter reads all of it. The fixes are the venue's, and every screen they
 * link to is one a promoter cannot open — a dead link reads as a step they
 * could take — so for them the links are absent.
 */
export function Parts({
  eventId,
  parts,
  next,
  canChange,
}: {
  eventId: string
  parts: EventRecord['parts']
  next: EventRecord['next']
  canChange: boolean
}) {
  const relevant = parts.filter((p) => p.applies)
  const finished = relevant.filter((p) => p.done).length

  // Module screens take the event they should open on, so a fix lands on this
  // night rather than on whichever the module would show first — for Bar,
  // that is the next night, not the one to close. The event record is this
  // page.
  const fixHref = (screen: string) =>
    screen === 'event' ? `/events/${eventId}` : `/${screen}?event=${eventId}`

  return (
    <div className={styles.gates}>
      <div className={styles.gatesHead}>
        <span className={styles.gatesTitle}>Where each part stands</span>
        <div className="rule-fade" />
        <span className={finished === relevant.length ? styles.good : styles.plain}>
          {finished} of {relevant.length} finished
        </span>
      </div>

      {parts.map((p) => {
        const moving =
          next !== null &&
          ((next.kind === 'booking' && p.key === 'booking') ||
            (next.kind === 'settle' && p.key === 'settlement'))
        // A part that is nothing to do yet — a licence the bar close does not
        // need, a settlement before the night — has no gates worth reading.
        const blocked = p.applies ? p.checks.filter((g) => !g.ok) : []

        const head = (
          <>
            <span className={styles.partName}>
              <i className={`ph ${p.icon}`} aria-hidden="true" />
              {p.label}
            </span>
            <span className={`${styles.partStatus} ${styles[`tone_${p.tone}`] ?? ''}`}>
              {p.tone === 'good' ? <i className="ph ph-check" aria-hidden="true" /> : null}
              {p.status}
              {p.detail ? <span className={styles.partDetail}>· {p.detail}</span> : null}
            </span>
            <span className={styles.partNote}>
              {moving && next
                ? `${next.title} · ${next.gatesDone}`
                : p.applies && p.checks.length > 0
                  ? p.gatesDone
                  : ''}
            </span>
          </>
        )

        const gates = blocked.map((g) => (
          <div key={g.label} className={`${styles.gate} ${styles.partGate}`}>
            <i className="ph ph-circle-dashed" aria-hidden="true" />
            <span className={styles.gateLabel}>{g.label}</span>
            <span className={styles.gateWhy}>{g.why}</span>
            {canChange ? (
              <Link href={fixHref(g.screen)} className="btn btn-ghost">
                Fix it
              </Link>
            ) : (
              <span className={styles.gateGap} />
            )}
          </div>
        ))

        const message =
          moving && next ? (
            <p
              className={`${next.clear ? styles.gatesMsgGood : styles.gatesMsg} ${styles.partMsg}`}
            >
              {next.message}
            </p>
          ) : null

        // Nothing failing, nothing to say: a plain row with nothing to open.
        if (blocked.length === 0 && !message) {
          return (
            <div key={p.key} className={styles.part} data-testid="event-part">
              <div className={styles.partHead}>{head}</div>
            </div>
          )
        }

        return (
          <details
            key={p.key}
            className={styles.part}
            open={moving || p.tone === 'warn' || p.tone === 'stop'}
            data-testid="event-part"
          >
            <summary className={`${styles.partHead} ${styles.partToggle}`}>{head}</summary>
            {gates}
            {message}
          </details>
        )
      })}
    </div>
  )
}
