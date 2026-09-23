import Link from 'next/link'
import { requireModule } from '@/lib/permissions'
import { loadRoster, fiveTimesLine } from '@/lib/roster-data'
import { money } from '@/lib/format'
import { SectionHeading } from '@/components/SectionHeading'
import { ActionButton } from '@/components/ActionButton'
import { ContactAvatar } from './ContactAvatar'
import { ShiftPicker } from './ShiftPicker'
import { ShiftEditor } from './ShiftEditor'
import { RosterTimeline } from './RosterTimeline'
import {
  askAgain,
  confirmOffer,
  declineOffer,
  deleteShift,
  duplicateShift,
  emailOffer,
  offerShift,
  renameShift,
  retimeShift,
} from './actions'
import styles from './roster.module.css'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** Doors-relative call time, as the crew talk about it. */
const call = (start: number) =>
  start === 0 ? 'from load-in' : `doors +${start === Math.floor(start) ? start : start.toFixed(2)}h`

export default async function RosterPage({ searchParams }: PageProps<'/roster'>) {
  const { user } = await requireModule('roster')

  const sp = await searchParams
  const { queue, event } = await loadRoster(user, one(sp.event))

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Roster</h1>
          <p className={styles.sub}>
            confirming a shift books the hours · nobody types a timesheet twice
          </p>
        </div>
      </header>

      <div className={styles.queue}>
        {queue.map((q) => (
          <Link
            key={q.id}
            href={`/roster?event=${q.id}`}
            className={`${styles.queueItem} ${event?.id === q.id ? styles.queueOn : ''}`}
          >
            <span className={styles.queueName}>{q.name}</span>
            <span className={styles.queueDate}>{q.date}</span>
            <span className={`${styles.queueNote} ${styles[q.tone]}`}>{q.note}</span>
          </Link>
        ))}
      </div>

      {event === null ? (
        <p className={styles.empty}>
          Nothing to crew. Events appear here once terms are agreed — asking people to hold a night
          for a show that has not been confirmed is how goodwill gets spent.
        </p>
      ) : (
        <div className={styles.body}>
          <div className={styles.eventHead}>
            <div>
              <h2 className={styles.eventName}>{event.name}</h2>
              <span className={styles.eventMeta}>
                {event.date} · {event.spaceName} · {event.format}
              </span>
              {fiveTimesLine(event) ? (
                <span className={styles.eventTimes}>{fiveTimesLine(event)}</span>
              ) : null}
            </div>
            <div className={styles.headStats}>
              <div className={styles.salesStrip}>
                <div className={styles.saleFigure}>
                  <span className={styles.saleLabel}>Sold</span>
                  <span className={`${styles.saleValue} tabular`}>{event.sales.sold}</span>
                </div>
                <div className={styles.saleFigure}>
                  <span className={styles.saleLabel}>Likely</span>
                  <span className={`${styles.saleValue} tabular`}>{event.sales.likely}</span>
                </div>
                <div className={styles.saleFigure}>
                  <span className={styles.saleLabel}>Capacity</span>
                  <span className={`${styles.saleValue} tabular`}>{event.sales.capacity}</span>
                </div>
                <div className={styles.saleFigure}>
                  <span className={styles.saleLabel}>Shifts planned</span>
                  <span className={`${styles.saleValue} tabular`}>
                    {event.shifts.length} of {event.sales.planned}
                  </span>
                </div>
              </div>
              <div className={styles.figures}>
                <div className={styles.figure}>
                  <span className={styles.figureLabel}>Rostered hours</span>
                  <span className={`${styles.figureValue} tabular`}>{event.callHours}</span>
                </div>
                <div className={styles.figure}>
                  <span className={styles.figureLabel}>Projected cost</span>
                  <span className={`${styles.figureValue} tabular`}>{money(event.callCost)}</span>
                </div>
              </div>
            </div>
          </div>

          <SectionHeading note={event.shortfall ?? 'fully crewed'}>
            Who is on — {event.shifts.length} shifts
          </SectionHeading>

          <RosterTimeline
            packIn={event.packIn}
            doors={event.doors}
            barClose={event.barClose}
            allOut={event.allOut}
            packOut={event.packOut}
            shifts={event.shifts.map((s) => ({
              id: s.id,
              role: s.role,
              start: s.start,
              hours: s.hours,
              state: s.state,
              personInitials: s.personInitials,
              // Bound, not wrapped: a closure created here cannot cross
              // into a client component.
              retime: retimeShift.bind(null, event.id, s.id),
            }))}
          />

          <ul className={styles.shifts}>
            {event.shifts.map((s) => {
              const open = s.state === 'OPEN' || s.state === 'ASKED'
              const offered = s.state === 'OFFERED'
              const rowTone = offered ? styles.shiftOffered : open ? styles.shiftOpen : ''
              return (
                <li key={s.id} className={`${styles.shift} ${rowTone}`}>
                  <div className={styles.shiftMain}>
                    <div className={styles.role}>
                      <span className={styles.roleName}>{s.role}</span>
                      <span className={styles.roleCall}>
                        {s.hours}h · {call(s.start)}
                      </span>
                    </div>

                    <div className={styles.who}>
                      <ContactAvatar
                        initials={s.personInitials}
                        name={s.personName}
                        email={s.personEmail}
                        phone={s.personPhone}
                        canEmailOffer={offered}
                        // Bound, not wrapped: a closure created here cannot
                        // cross into a client component.
                        emailOffer={emailOffer.bind(null, event.id, s.id)}
                      />
                      <ShiftPicker
                        value={s.personId ?? ''}
                        candidates={s.candidates}
                        assign={offerShift.bind(null, event.id, s.id)}
                      />
                    </div>

                    <div className={styles.state}>
                      {offered ? (
                        <>
                          <span className={styles.offered}>
                            <i className="ph ph-hourglass-medium" aria-hidden="true" />
                            offered
                          </span>
                          <ActionButton
                            className={styles.confirmButton}
                            action={confirmOffer.bind(null, event.id, s.id)}
                            title="They said yes in the room"
                          >
                            Confirm now
                          </ActionButton>
                          <ActionButton
                            className={styles.askButton}
                            action={emailOffer.bind(null, event.id, s.id)}
                            title="Email them a link to confirm or decline"
                          >
                            Email offer
                          </ActionButton>
                          <ActionButton
                            className={styles.declineButton}
                            action={declineOffer.bind(null, event.id, s.id)}
                            title="Record that they said no"
                          >
                            Decline
                          </ActionButton>
                        </>
                      ) : open ? (
                        <>
                          <span className={styles.asked}>
                            {s.asked === 0 ? 'not asked yet' : `asked ${s.asked}`}
                          </span>
                          <ActionButton
                            className={styles.askButton}
                            action={askAgain.bind(null, event.id, s.id)}
                            title="Record another ask without filling it"
                          >
                            Ask again
                          </ActionButton>
                        </>
                      ) : (
                        <span className={styles.good}>
                          <i className="ph ph-check-circle" aria-hidden="true" />
                          covered
                        </span>
                      )}
                    </div>
                  </div>

                  <ShiftEditor
                    role={s.role}
                    startInput={s.startInput}
                    endInput={s.endInput}
                    packIn={event.packIn}
                    packOut={event.packOut}
                    // Bound, not wrapped: a closure created here cannot cross
                    // into a client component.
                    rename={renameShift.bind(null, event.id, s.id)}
                    retime={retimeShift.bind(null, event.id, s.id)}
                    duplicate={duplicateShift.bind(null, event.id, s.id)}
                    del={deleteShift.bind(null, event.id, s.id)}
                  />
                </li>
              )
            })}
          </ul>

          <p className={styles.footnote}>
            Every confirmed shift above wrote an hour entry against this event at that person’s rate
            — an offer on its own books nothing. The figure in Finance and the figure here are the
            same number read twice, not two numbers kept in step.
          </p>
        </div>
      )}
    </div>
  )
}
