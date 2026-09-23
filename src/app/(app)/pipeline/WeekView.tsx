import Link from 'next/link'
import { dayBlocks, hourLabel, weekDays } from '@/lib/calendar'
import { isAtRisk, type PipelineEvent } from '@/lib/pipeline'
import styles from './week.module.css'

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * "On the week view you should be able to see the actual times booked out
 * for each event" (Connor, 23 Sep 2026): seven day columns against a
 * vertical hour axis, each event a block from pack-in to pack-out, falling
 * back to doors/everyone-out and then a default evening window — see
 * `runWindow` in src/lib/calendar.ts, which also says why. Overlapping
 * events sit side by side rather than being refused (`dayBlocks`'s lane
 * layout); nothing here decides that, it only reads the lane it was given.
 *
 * Block position and size are computed fractions of the day, not tokens —
 * `top`/`height`/`left`/`width` are per-event data, the one thing on this
 * page that colour, gap and radius tokens have nothing to say about.
 */
export function WeekView({
  all,
  monday,
  today,
}: {
  all: PipelineEvent[]
  monday: Date
  today: Date
}) {
  const days = weekDays(monday, today)

  return (
    <div className={styles.scroller}>
      <div className={styles.grid}>
        <div className={styles.axisHead} />
        {days.map((d, i) => (
          <div
            key={d.date.toISOString()}
            className={`${styles.dayHead} ${d.isToday ? styles.dayHeadToday : ''}`}
          >
            <span className={styles.dowLabel}>{DOW_LABELS[i]}</span>
            <span className={styles.dateNum}>{d.date.getUTCDate()}</span>
          </div>
        ))}

        <div className={styles.axis}>
          {HOURS.map((h) => (
            <span key={h} className={styles.hourLabel}>
              {hourLabel(h)}
            </span>
          ))}
        </div>

        {days.map((d) => {
          const blocks = dayBlocks(all, d.date)
          return (
            <div key={d.date.toISOString()} className={styles.day}>
              {HOURS.map((h) => (
                <span key={h} className={styles.hourLine} />
              ))}
              {blocks.map((b) => {
                const tone = b.event.riskKind === 'stop' ? styles.blockStop : styles.blockWarn
                return (
                  <Link
                    key={b.event.id}
                    href={`/events/${b.event.id}`}
                    className={`${styles.block} ${b.event.concluded ? styles.blockConcluded : ''} ${isAtRisk(b.event) ? tone : ''} ${b.defaulted ? styles.blockDefaulted : ''}`}
                    style={{
                      top: `${b.top * 100}%`,
                      height: `${b.height * 100}%`,
                      left: `${(b.lane / b.lanes) * 100}%`,
                      width: `${(1 / b.lanes) * 100}%`,
                    }}
                    title={`${b.event.name} · ${b.startLabel}${b.clipped ? ` → ${b.endLabel}, past midnight` : ` – ${b.endLabel}`}`}
                  >
                    <span className={styles.blockName}>{b.event.name}</span>
                    <span className={styles.blockTime}>{b.label}</span>
                  </Link>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
