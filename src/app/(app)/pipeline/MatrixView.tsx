import Link from 'next/link'
import { metaLine, partTitle, runLine, type PartHead, type PipelineEvent } from '@/lib/pipeline'
import { days as dayLabel } from '@/lib/format'
import styles from './pipeline.module.css'

/** The cell swatches, in the order a part usually moves through them. */
const TONES = [
  { tone: 'dim', label: 'not started, or nothing to do' },
  { tone: 'plain', label: 'under way' },
  { tone: 'good', label: 'finished' },
  { tone: 'warn', label: 'wants attention' },
  { tone: 'stop', label: 'blocked' },
] as const

/**
 * The default view: one row a live event, its eight parts each on their own
 * track. Unchanged from before the Month and Week views arrived beside it —
 * see page.tsx for the filters and sort that shape `rows`.
 */
export function MatrixView({ heads, rows }: { heads: PartHead[]; rows: PipelineEvent[] }) {
  return (
    <div className={styles.scroller}>
      <div className={styles.matrix}>
        <div className={styles.headRow}>
          <div className={styles.headEvent}>Event</div>
          <div className={styles.track}>
            {heads.map((h) => (
              <span
                key={h.key}
                className={styles.headStage}
                title={`${h.toGo} live ${h.toGo === 1 ? 'event' : 'events'} still to finish this part${h.nick ? ` — ${h.nick}` : ''}`}
              >
                {h.label}
                <br />
                <span className={styles.headCount}>{h.count}</span>
              </span>
            ))}
          </div>
          <div className={styles.headRight}>Door</div>
        </div>

        {rows.map((e) => {
          const atRisk = e.riskNote !== null
          // A missing owner wants attention too, but it is not the
          // coordinator's own flag — it only takes the tone when nothing
          // louder is already claiming this line.
          const noOwner = !atRisk && e.ownerName === null
          const tone = e.riskKind === 'stop' ? styles.stop : styles.warn
          return (
            <div
              key={e.id}
              className={`${styles.row} ${atRisk ? tone : ''}`}
              data-testid="pipeline-row"
            >
              <span className={styles.name}>
                <Link href={`/events/${e.id}`} className={styles.eventName}>
                  {e.name}
                </Link>
                <span
                  className={`${styles.meta} ${atRisk ? styles.metaRisk : noOwner ? styles.metaWarn : ''}`}
                >
                  {atRisk ? (
                    <i
                      className={`ph ${e.riskKind === 'stop' ? 'ph-warning-octagon' : 'ph-warning'}`}
                      aria-hidden="true"
                    />
                  ) : null}
                  {metaLine(e)}
                </span>
                <span className={styles.runLine}>{runLine(e)}</span>
              </span>

              {/* Each part of the event, where it stands on its own. None of
                  them waits on the one to its left. */}
              <span className={styles.track}>
                {e.parts.map((p) => (
                  <span
                    key={p.key}
                    className={`${styles.cell} ${styles[`tone_${p.tone}`] ?? ''} tabular`}
                    title={partTitle(p)}
                    data-part={p.key}
                  >
                    <span className={styles.cellStatus}>
                      {p.tone === 'good' ? <i className="ph ph-check" aria-hidden="true" /> : null}
                      {p.status}
                    </span>
                    {p.detail ? <span className={styles.cellDetail}>{p.detail}</span> : null}
                  </span>
                ))}
              </span>

              <span className={styles.right}>
                <span className={`${styles.days} tabular`}>
                  {e.concluded ? 'done' : dayLabel(e.daysToDoor)}
                </span>
              </span>
            </div>
          )
        })}

        {rows.length === 0 ? <p className={styles.empty}>Nothing matches that.</p> : null}

        <p className={styles.legend}>
          {TONES.map((t) => (
            <span key={t.tone} className={styles.legendItem}>
              <span className={`${styles.swatch} ${styles[`tone_${t.tone}`]}`} />
              {t.label}
            </span>
          ))}
          <span className={styles.legendHint}>
            Every part is worked out from its own records. Hover a cell for what holds it up.
          </span>
        </p>
      </div>
    </div>
  )
}
