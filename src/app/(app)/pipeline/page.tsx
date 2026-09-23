import Link from 'next/link'
import { requireModule } from '@/lib/permissions'
import { loadPipeline } from '@/lib/pipeline-data'
import { mayStartEnquiry } from '@/lib/intake'
import { addDays, mondayOf, monthFromInput, monthLabel, monthToInput } from '@/lib/calendar'
import { dateLabel } from '@/lib/format'
import { nightFromInput, nightInput, venueToday } from '@/lib/night'
import {
  partHeads,
  pipelineRows,
  pipelineSubline,
  type SortKey,
  type StatusFilter,
} from '@/lib/pipeline'
import { NewEnquiry } from '@/components/NewEnquiry'
import { MatrixView } from './MatrixView'
import { MonthView } from './MonthView'
import { WeekView } from './WeekView'
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

type View = 'matrix' | 'month' | 'week'

/** Matrix (today's page) is the default — Month and Week sit beside it,
 *  carried in the query string the same way the filters are, so a bookmark
 *  keeps it (Connor, 23 Sep 2026). */
const VIEW_TABS: { key: View; label: string }[] = [
  { key: 'matrix', label: 'Matrix' },
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
]

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
  const viewParam = one(sp.view)
  const view: View = viewParam === 'month' ? 'month' : viewParam === 'week' ? 'week' : 'matrix'

  // Every view reads the same rows — an external user sees only their own
  // events regardless of which one is on screen, since the scoping is in
  // this query (src/lib/scope.ts), not in how a view chooses to draw them.
  const all = await loadPipeline(user)
  const rows = pipelineRows(all, { status, sort, meInitials: user.initials })
  const heads = partHeads(all)

  const today = venueToday()
  const month = monthFromInput(one(sp.month)) ?? {
    year: today.getUTCFullYear(),
    monthIndex: today.getUTCMonth(),
  }
  const monday = mondayOf(nightFromInput(one(sp.week) ?? '') ?? today)

  const href = (
    next: Partial<{ view: string; status: string; sort: string; month: string; week: string }>,
  ) => {
    const q = new URLSearchParams({
      view,
      status,
      sort,
      month: monthToInput(month.year, month.monthIndex),
      week: nightInput(monday),
      ...next,
    })
    return `/pipeline?${q.toString()}`
  }

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{user.external ? 'Your events' : 'Pipeline'}</h1>
          <p className={styles.sub}>
            {user.external ? (
              <>
                <span className={styles.kicker}>{user.organisationName}</span> ·{' '}
              </>
            ) : null}
            {pipelineSubline(all, view === 'matrix' ? rows.length : all.length)}
          </p>
        </div>
        {mayStartEnquiry(user).ok ? <NewEnquiry /> : null}
      </header>

      <div className={styles.filters}>
        {VIEW_TABS.map((v) => (
          <Link
            key={v.key}
            href={href({ view: v.key })}
            className={`${styles.chip} ${view === v.key ? styles.chipOn : ''}`}
          >
            {v.label}
          </Link>
        ))}

        {view === 'matrix' ? (
          <>
            <span className={styles.chipDivider} />
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
            <Link
              href={href({ sort: sort === 'door' ? 'attention' : 'door' })}
              className={styles.sort}
            >
              {SORTS[sort]}
              <i className="ph ph-arrows-down-up" aria-hidden="true" />
            </Link>
          </>
        ) : null}

        {view === 'month' ? (
          <>
            <span className={styles.spacer} />
            <nav className={styles.calNav} aria-label="Month">
              <Link
                href={href({ month: monthToInput(month.year, month.monthIndex - 1) })}
                className={styles.calStep}
                aria-label="Previous month"
              >
                <i className="ph ph-caret-left" aria-hidden="true" />
              </Link>
              <span className={styles.calTitle}>{monthLabel(month.year, month.monthIndex)}</span>
              <Link
                href={href({ month: monthToInput(month.year, month.monthIndex + 1) })}
                className={styles.calStep}
                aria-label="Next month"
              >
                <i className="ph ph-caret-right" aria-hidden="true" />
              </Link>
              <Link
                href={href({ month: monthToInput(today.getUTCFullYear(), today.getUTCMonth()) })}
                className={styles.calToday}
              >
                Today
              </Link>
            </nav>
          </>
        ) : null}

        {view === 'week' ? (
          <>
            <span className={styles.spacer} />
            <nav className={styles.calNav} aria-label="Week">
              <Link
                href={href({ week: nightInput(addDays(monday, -7)) })}
                className={styles.calStep}
                aria-label="Previous week"
              >
                <i className="ph ph-caret-left" aria-hidden="true" />
              </Link>
              <span className={styles.calTitle}>
                {dateLabel(monday)} – {dateLabel(addDays(monday, 6))}
              </span>
              <Link
                href={href({ week: nightInput(addDays(monday, 7)) })}
                className={styles.calStep}
                aria-label="Next week"
              >
                <i className="ph ph-caret-right" aria-hidden="true" />
              </Link>
              <Link href={href({ week: nightInput(mondayOf(today)) })} className={styles.calToday}>
                Today
              </Link>
            </nav>
          </>
        ) : null}
      </div>

      <div className={styles.body}>
        {view === 'matrix' ? (
          <MatrixView heads={heads} rows={rows} />
        ) : view === 'month' ? (
          <MonthView all={all} year={month.year} monthIndex={month.monthIndex} today={today} />
        ) : (
          <WeekView all={all} monday={monday} today={today} />
        )}
      </div>
    </div>
  )
}
