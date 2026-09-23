import Link from 'next/link'
import { eventsOnDay, monthGrid } from '@/lib/calendar'
import { isAtRisk, runLine, type PipelineEvent } from '@/lib/pipeline'
import styles from './month.module.css'

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * "Similar to a Google Calendar view" (Connor, 23 Sep 2026): a seven-column,
 * Monday-first grid of the month, every event's card on every date it
 * covers — see `eventsOnDay` in src/lib/calendar.ts. No status filter or
 * sort applies here; a calendar shows what is on each date, including a
 * concluded event, dimmed rather than dropped.
 */
export function MonthView({
  all,
  year,
  monthIndex,
  today,
}: {
  all: PipelineEvent[]
  year: number
  monthIndex: number
  today: Date
}) {
  const grid = monthGrid(year, monthIndex, today)

  return (
    <div className={styles.scroller}>
      <div className={styles.grid}>
        {DOW_LABELS.map((d) => (
          <div key={d} className={styles.dowHead}>
            {d}
          </div>
        ))}

        {grid.map((day) => {
          const events = eventsOnDay(all, day.date)
          return (
            <div
              key={day.date.toISOString()}
              className={`${styles.cell} ${day.inMonth ? '' : styles.cellOut} ${day.isToday ? styles.cellToday : ''}`}
            >
              <span className={styles.dateNum}>{day.date.getUTCDate()}</span>
              <div className={styles.events}>
                {events.map((e) => {
                  const tone = e.riskKind === 'stop' ? styles.eventStop : styles.eventWarn
                  return (
                    <Link
                      key={e.id}
                      href={`/events/${e.id}`}
                      className={`${styles.event} ${e.concluded ? styles.eventConcluded : ''} ${isAtRisk(e) ? tone : ''}`}
                      title={`${e.name} — ${runLine(e)}`}
                    >
                      <span className={styles.eventName}>{e.name}</span>
                      {e.doors ? <span className={styles.eventTime}>{e.doors}</span> : null}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
