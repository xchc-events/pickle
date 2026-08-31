import Link from 'next/link'
import { requireModule } from '@/lib/permissions'
import { loadPipeline } from '@/lib/pipeline-data'
import {
  labourSplit,
  metaLine,
  pipelineMetrics,
  pipelineRows,
  pipelineSubline,
  projection,
  stageCells,
  stageCounts,
  type SortKey,
  type SpaceFilter,
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

const SPACE_CHIPS: { key: SpaceFilter; label: string }[] = [
  { key: 'all', label: 'Both spaces' },
  { key: 'main', label: 'Main space' },
  { key: 'apt', label: 'Apartment U1' },
]

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function PipelinePage({ searchParams }: PageProps<'/pipeline'>) {
  // Server-side gate. A role without pipeline gets a 404 here, not a hidden
  // link — this is the control, the sidebar is only the convenience.
  const { user } = await requireModule('pipeline')

  const sp = await searchParams
  const status = (one(sp.status) ?? 'all') as StatusFilter
  const space = (one(sp.space) ?? 'all') as SpaceFilter
  const sort = (one(sp.sort) ?? 'door') as SortKey

  const all = await loadPipeline(user)
  const rows = pipelineRows(all, { status, space, sort, meInitials: user.initials })
  const heads = stageCounts(all)
  const metrics = pipelineMetrics(all)
  const labour = labourSplit(all)

  const href = (next: Partial<{ status: string; space: string; sort: string }>) => {
    const q = new URLSearchParams({ status, space, sort, ...next })
    return `/pipeline?${q.toString()}`
  }

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{user.external ? 'Your events' : 'Pipeline'}</h1>
          <p className={styles.sub}>
            <span className={styles.kicker}>{user.external ? user.promoter : 'the Crock'}</span> ·{' '}
            {pipelineSubline(all, rows.length)}
          </p>
        </div>
        {/* An external promoter does not start enquiries from in here. */}
        {user.external ? null : <NewEnquiry />}
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
        <span className={styles.chipDivider} />
        {SPACE_CHIPS.map((c) => (
          <Link
            key={c.key}
            href={href({ space: c.key })}
            className={`${styles.chip} ${space === c.key ? styles.chipOn : ''}`}
          >
            {c.label}
          </Link>
        ))}
        <span className={styles.spacer} />
        <Link href={href({ sort: sort === 'door' ? 'stuck' : 'door' })} className={styles.sort}>
          {sort === 'door' ? 'Sorted by days to door' : 'Sorted by time stuck'}
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
                  <span key={h.label} className={styles.headStage}>
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
              const cells = stageCells(e.stage, e.daysInStage, atRisk)
              const tone = e.riskKind === 'stop' ? styles.stop : styles.warn
              return (
                <div
                  key={e.id}
                  className={`${styles.row} ${atRisk ? tone : ''}`}
                  data-testid="pipeline-row"
                >
                  <span className={styles.name}>
                    <span className={styles.eventName}>{e.name}</span>
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

                  <span className={styles.track}>
                    {cells.map((c, i) => (
                      <span
                        key={i}
                        className={`${styles.cell} ${styles[c.state]} ${c.risky ? styles.cellRisk : ''} tabular`}
                      >
                        {c.text}
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
