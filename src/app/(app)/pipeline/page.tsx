import Link from 'next/link'
import { requireModule } from '@/lib/permissions'
import { loadPipeline } from '@/lib/pipeline-data'
import { mayStartEnquiry } from '@/lib/intake'
import {
  labourSplit,
  metaLine,
  partHeads,
  partTitle,
  pipelineMetrics,
  pipelineRows,
  pipelineSubline,
  projection,
  type SortKey,
  type StatusFilter,
} from '@/lib/pipeline'
import { days as dayLabel } from '@/lib/format'
import { SectionHeading } from '@/components/SectionHeading'
import { MetricStrip } from '@/components/MetricStrip'
import { Avatar } from '@/components/Avatar'
import { NewEnquiry } from '@/components/NewEnquiry'
import styles from './pipeline.module.css'

const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Everything' },
  { key: 'mine', label: 'Mine' },
  { key: 'risk', label: 'At risk' },
  { key: 'soon', label: 'Next 30 days' },
  { key: 'done', label: 'Concluded' },
]

const SORTS: Record<SortKey, string> = {
  door: 'Sorted by days to door',
  attention: 'Sorted by what needs attention',
}

/** The cell swatches, in the order a part usually moves through them. */
const TONES = [
  { tone: 'dim', label: 'not started, or nothing to do' },
  { tone: 'plain', label: 'under way' },
  { tone: 'good', label: 'finished' },
  { tone: 'warn', label: 'wants attention' },
  { tone: 'stop', label: 'blocked' },
] as const

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function PipelinePage({ searchParams }: PageProps<'/pipeline'>) {
  // Server-side gate. A role without pipeline gets a 404 here, not a hidden
  // link — this is the control, the sidebar is only the convenience.
  const { user } = await requireModule('pipeline')

  const sp = await searchParams
  const status = (one(sp.status) ?? 'all') as StatusFilter
  // Anything else — including the "stuck" sort a bookmark may still carry
  // from when an event sat in one stage — reads as days to door.
  const sort: SortKey = one(sp.sort) === 'attention' ? 'attention' : 'door'

  const all = await loadPipeline(user)
  const rows = pipelineRows(all, { status, sort, meInitials: user.initials })
  const heads = partHeads(all)
  const metrics = pipelineMetrics(all)
  const labour = labourSplit(all)

  const href = (next: Partial<{ status: string; sort: string }>) => {
    const q = new URLSearchParams({ status, sort, ...next })
    return `/pipeline?${q.toString()}`
  }

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{user.external ? 'Your events' : 'Pipeline'}</h1>
          <p className={styles.sub}>
            <span className={styles.kicker}>
              {user.external ? user.organisationName : 'the Crock'}
            </span>{' '}
            · {pipelineSubline(all, rows.length)}
          </p>
        </div>
        {mayStartEnquiry(user).ok ? <NewEnquiry /> : null}
      </header>

      <div className={styles.filters}>
        {STATUS_CHIPS.map((c) => (
          <Link
            key={c.key}
            href={href({ status: c.key })}
            className={`${styles.chip} ${status === c.key ? styles.chipOn : ''}`}
          >
            {c.label}
          </Link>
        ))}
        <span className={styles.spacer} />
        <Link href={href({ sort: sort === 'door' ? 'attention' : 'door' })} className={styles.sort}>
          {SORTS[sort]}
          <i className="ph ph-arrows-down-up" aria-hidden="true" />
        </Link>
      </div>

      <div className={styles.body}>
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
              <div className={styles.headRight}>Door · projection · who owns it</div>
            </div>

            {rows.map((e) => {
              const atRisk = e.riskNote !== null
              const proj = projection(e)
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
                    <span className={`${styles.meta} ${atRisk ? styles.metaRisk : ''}`}>
                      {atRisk ? (
                        <i
                          className={`ph ${e.riskKind === 'stop' ? 'ph-warning-octagon' : 'ph-warning'}`}
                          aria-hidden="true"
                        />
                      ) : null}
                      {metaLine(e)}
                    </span>
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
                          {p.tone === 'good' ? (
                            <i className="ph ph-check" aria-hidden="true" />
                          ) : null}
                          {p.status}
                        </span>
                        {p.detail ? <span className={styles.cellDetail}>{p.detail}</span> : null}
                      </span>
                    ))}
                  </span>

                  <span className={styles.right}>
                    <span className={styles.figures}>
                      <span className={`${styles.days} tabular`}>
                        {e.concluded ? 'done' : dayLabel(e.daysToDoor)}
                      </span>
                      <span className={`${styles.proj} ${styles[proj.tone]} tabular`}>
                        {proj.text}
                      </span>
                    </span>
                    <Avatar
                      initials={e.ownerInitials ?? '–'}
                      title={
                        e.ownerName ? `Internal owner — ${e.ownerName}` : 'No internal owner yet'
                      }
                      accent={e.ownerAccent}
                    />
                    {e.extCoordInitials ? (
                      <Avatar
                        initials={e.extCoordInitials}
                        title={`External coordinator — ${e.extCoordName}`}
                        external
                      />
                    ) : (
                      <span className={styles.avatarGap} />
                    )}
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

        <div className={styles.metrics}>
          <MetricStrip metrics={metrics} />
        </div>

        <div className={styles.labour}>
          <SectionHeading note="Rostered shifts plus hours entered against tasks, all events in the pipeline">
            Where the labour goes
          </SectionHeading>
          <div className={styles.labourRows}>
            {labour.map((l) => (
              <div key={l.label} className={styles.labourRow}>
                <span className={styles.labourLabel}>{l.label}</span>
                <span className={styles.bar}>
                  <span className={styles.barFill} style={{ width: `${l.widthPct}%` }} />
                </span>
                <span className={`${styles.labourValue} tabular`}>{l.value}</span>
                <span className={`${styles.labourCost} tabular`}>{l.cost}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
