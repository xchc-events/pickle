import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireModule } from '@/lib/permissions'
import { barRefusal, DRIVER_LABEL, marginTone, varianceTone } from '@/lib/bar'
import type { BarNight, DriverKey, Tone } from '@/lib/bar'
import { loadBarEvents, loadBarMonths, type BarDetail } from '@/lib/bar-data'
import { CFG, PLANNED_HOUR_COST } from '@/lib/finance'
import { hrs, money } from '@/lib/format'
import { SectionHeading } from '@/components/SectionHeading'
import { ActionButton } from '@/components/ActionButton'
import { CloseBar } from './CloseBar'
import { lockBudgetLate } from './actions'
import styles from './bar.module.css'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`
const cents = (n: number | null) => (n === null ? '—' : `$${n.toFixed(2)}`)
/**
 * `+$212`, `−$38`. A difference that rounds to nothing reads as a dash rather
 * than "−$0" — a sign on a zero invites somebody to ask which way it went.
 */
const signed = (n: number) =>
  Math.abs(n) < 0.5 ? '—' : `${n < 0 ? '−' : '+'}${money(Math.abs(n))}`

/**
 * Bar.
 *
 * Three questions, in the order a person asks them: what did we think this
 * night would do, what did it actually do and why, and what does the run of
 * nights say about the months ahead. The first two are By event; the third is
 * By month.
 *
 * Epos Now is the till and the stock system, and its own Xero app sends bar
 * sales to Xero. So there is no ordering here and no posting — only the budget,
 * the till read that closes a night, and the arithmetic that explains the gap.
 */
export default async function BarPage({ searchParams }: PageProps<'/bar'>) {
  const { user } = await requireModule('bar')
  // The bar is the venue's own trading. Denial is a 404, as everywhere else.
  if (barRefusal(user)) notFound()

  const sp = await searchParams
  const view = one(sp.view) === 'months' ? 'months' : 'events'

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Bar</h1>
          <p className={styles.sub}>
            <span className={styles.kicker}>the Cellar</span> · what we expected, what happened, and
            why · Epos Now is the till, and tells Xero
          </p>
        </div>
        <nav className={styles.views} aria-label="Bar views">
          <Link
            href="/bar"
            className={`${styles.view} ${view === 'events' ? styles.viewOn : ''}`}
            aria-current={view === 'events' ? 'page' : undefined}
          >
            By event
          </Link>
          <Link
            href="/bar?view=months"
            className={`${styles.view} ${view === 'months' ? styles.viewOn : ''}`}
            aria-current={view === 'months' ? 'page' : undefined}
          >
            By month
          </Link>
        </nav>
      </header>

      {view === 'months' ? <Months user={user} /> : <Events user={user} wanted={one(sp.event)} />}
    </div>
  )
}

type User = Awaited<ReturnType<typeof requireModule>>['user']

// ---------------------------------------------------------------- events ---

async function Events({ user, wanted }: { user: User; wanted: string | undefined }) {
  const { rail, event, eposConnected } = await loadBarEvents(user, wanted)

  return (
    <>
      <div className={styles.queue}>
        {rail.map((r) => (
          <Link
            key={r.id}
            href={`/bar?event=${r.id}`}
            className={`${styles.queueItem} ${event?.id === r.id ? styles.queueOn : ''}`}
          >
            <span className={styles.queueName}>{r.name}</span>
            <span className={styles.queueDate}>{r.date}</span>
            <span className={styles.queueNote}>
              <b className="tabular">{r.figure}</b> <span className={styles[r.tone]}>{r.note}</span>
            </span>
          </Link>
        ))}
      </div>

      {event === null ? (
        <p className={styles.empty}>
          No nights to budget. Events appear here once terms are agreed — a bar budget for a show
          that has not been confirmed is a budget for a night that may not happen.
        </p>
      ) : (
        <EventDetail event={event} eposConnected={eposConnected} />
      )}
    </>
  )
}

function EventDetail({ event: e, eposConnected }: { event: BarDetail; eposConnected: boolean }) {
  const now = e.actual ?? e.projection
  const nowLabel = e.actual ? 'Actual' : 'Projected now'
  const diffLabel = e.actual ? 'Over / under' : 'Moved since lock'

  return (
    <div className={styles.body}>
      <div className={styles.eventHead}>
        <div>
          <h2 className={styles.eventName}>{e.name}</h2>
          <span className={styles.eventMeta}>
            {e.date} · {e.spaceName} · {e.saleLabel}
          </span>
        </div>
        <span className={styles.windowTag}>
          <i className="ph ph-beer-bottle" aria-hidden="true" />
          {e.window.opens && e.window.closes
            ? `bar ${e.window.opens} – ${e.window.closes} · ${hrs(e.window.hours ?? 0)} of service`
            : 'service window not set'}
        </span>
      </div>

      <div className={styles.grid}>
        <div className={styles.main}>
          <SectionHeading note={e.budgetNote}>The night</SectionHeading>

          {e.canLockLate ? (
            <div className={styles.callout}>
              <p>
                No budget to measure this night against. It went on sale before bar budgets existed,
                so nothing was locked when tickets went live.
              </p>
              <ActionButton className="btn btn-secondary" action={lockBudgetLate.bind(null, e.id)}>
                Lock it at today’s projection
              </ActionButton>
            </div>
          ) : null}

          <NightTable budget={e.budget} now={now} nowLabel={nowLabel} diffLabel={diffLabel} />

          {e.actual && !e.doorCounted ? (
            <p className={styles.note}>
              The door is not counted yet, so spend per head and turnout are unknown. Count it on
              the event record and this splits the takings into the two.
            </p>
          ) : null}

          {e.variance ? (
            <>
              <SectionHeading note={e.driver ?? 'nothing moved it'}>Why</SectionHeading>
              <Effects effects={e.variance.effects} total={e.variance.contributionVariance} />
            </>
          ) : null}

          {e.actual ? (
            <>
              <SectionHeading
                note={
                  e.sales.length > 0
                    ? 'read off Epos Now when the bar was closed'
                    : 'only a bar closed off the till has one'
                }
              >
                What sold
              </SectionHeading>
              <Sold detail={e} />
            </>
          ) : null}
        </div>

        <aside className={styles.aside}>
          <div className={styles.card}>
            <div className={styles.cardTitle}>Close the bar</div>
            <p className={styles.closeStatus}>
              <i
                className={`ph ${e.actual ? 'ph-check-circle' : 'ph-circle-dashed'}`}
                aria-hidden="true"
              />
              {e.actualNote ?? 'Not closed yet'}
            </p>
            <CloseBar
              eventId={e.id}
              canClose={e.canClose}
              tillReady={e.tillReady}
              tillWhy={e.tillWhy}
              barHalf={e.barHalf}
            />
          </div>

          <div className={styles.cardPlain}>
            <div className={styles.cardTitlePlain}>Service window</div>
            <Fact label="Bar opens" value={e.window.opens ?? 'doors not set'} />
            <Fact label="Bar closes" value={e.window.closes ?? 'not set'} />
            <Fact label="Everyone out" value={e.allOut ?? 'not set'} />
            <Fact label="Tickets sold" value={String(e.sold)} />
            <p className={styles.cardNote}>
              The window comes off the event record — change doors or the bar close time there and
              this moves with it, along with the till read and the special licence.{' '}
              <Link href={`/events/${e.id}`} className={styles.link}>
                Open the event record
              </Link>
            </p>
          </div>

          {!eposConnected ? (
            <p className={styles.asideNote}>
              Epos Now is not connected on this install. Bars are closed by hand until
              EPOSNOW_API_KEY and EPOSNOW_API_SECRET are set — see the README.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <span className={styles.factValue}>{value}</span>
    </div>
  )
}

/**
 * The night against its budget.
 *
 * For a cost line, more is worse, so the tone of its difference is turned
 * round. Every difference is the night's figure less the budget's — the same
 * sign everywhere, so a column of them can be read down without stopping.
 */
function NightTable({
  budget,
  now,
  nowLabel,
  diffLabel,
}: {
  budget: BarNight | null
  now: BarNight
  nowLabel: string
  diffLabel: string
}) {
  type Row = {
    label: string
    pick: (n: BarNight) => number | null
    show: (v: number | null) => string
    cost?: boolean
    total?: boolean
    sub?: (n: BarNight) => string
  }

  const rows: Row[] = [
    {
      label: 'Through the door',
      pick: (n) => n.heads,
      show: (v) => (v === null ? 'not counted' : String(v)),
    },
    { label: 'Spend per head', pick: (n) => n.spendPerHead, show: cents },
    { label: 'Take, GST incl', pick: (n) => n.take, show: (v) => money(v ?? 0) },
    { label: 'Stock cost', pick: (n) => n.stockCost, show: (v) => money(v ?? 0), cost: true },
    {
      label: 'Bar margin after stock',
      pick: (n) => n.margin,
      show: (v) => money(v ?? 0),
      sub: (n) => pct(n.marginPct),
    },
    {
      label: 'Bar labour',
      pick: (n) => n.labour,
      show: (v) => money(v ?? 0),
      cost: true,
      sub: (n) => hrs(n.labourHours),
    },
    {
      label: 'What the bar keeps',
      pick: (n) => n.contribution,
      show: (v) => money(v ?? 0),
      total: true,
    },
  ]

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th />
            <th className={styles.num}>Budget</th>
            <th className={styles.num}>{nowLabel}</th>
            <th className={styles.num}>{budget ? diffLabel : ''}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = budget ? r.pick(budget) : null
            const n = r.pick(now)
            // An uncounted door has no heads and no spend per head, so those
            // two rows carry no difference until it is counted.
            const diff = b !== null && n !== null ? n - b : null
            const tone: Tone = diff === null ? 'plain' : varianceTone(r.cost ? -diff : diff)
            return (
              <tr key={r.label} className={r.total ? styles.totalRow : undefined}>
                <th scope="row" className={styles.rowLabel}>
                  {r.label}
                </th>
                <td className={`${styles.num} tabular`}>
                  {budget ? r.show(b) : '—'}
                  {budget && r.sub ? <span className={styles.cellSub}>{r.sub(budget)}</span> : null}
                </td>
                <td className={`${styles.num} tabular`}>
                  {r.show(n)}
                  {r.sub ? (
                    <span
                      className={`${styles.cellSub} ${r.label.startsWith('Bar margin') ? styles[marginTone(now.marginPct)] : ''}`}
                    >
                      {r.sub(now)}
                    </span>
                  ) : null}
                </td>
                <td className={`${styles.num} tabular ${styles[tone]}`}>
                  {diff === null
                    ? ''
                    : r.label === 'Through the door'
                      ? diff === 0
                        ? '—'
                        : `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`
                      : r.label === 'Spend per head'
                        ? Math.abs(diff) < 0.005
                          ? '—'
                          : `${diff < 0 ? '−' : '+'}$${Math.abs(diff).toFixed(2)}`
                        : signed(diff)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const EFFECT_ORDER: DriverKey[] = ['turnout', 'spend', 'take', 'rate', 'labour']

const EFFECT_NOTE: Record<DriverKey, string> = {
  turnout: 'more or fewer people than budgeted, at the budgeted spend',
  spend: 'each person spending more or less than budgeted',
  take: 'turnout and spend together — the door is not counted, so they cannot be told apart',
  rate: `the margin after stock against the ${pct(1 - CFG.stockCost)} the budget assumed`,
  labour: `more or fewer bar hours than planned, at $${PLANNED_HOUR_COST}/hr`,
}

/** The reasons, each in what the bar keeps. They add up to the total exactly. */
function Effects({ effects, total }: { effects: Record<DriverKey, number>; total: number }) {
  const shown = EFFECT_ORDER.filter(
    (k) => Math.abs(effects[k]) >= 1 || (k !== 'take' && k !== 'turnout' && k !== 'spend'),
  )
  return (
    <div className={styles.effects}>
      {shown.map((k) => (
        <div key={k} className={styles.effect}>
          <span className={styles.effectLabel}>{DRIVER_LABEL[k]}</span>
          <span className={`${styles.effectValue} tabular ${styles[varianceTone(effects[k])]}`}>
            {signed(effects[k])}
          </span>
          <span className={styles.effectNote}>{EFFECT_NOTE[k]}</span>
        </div>
      ))}
      <div className={`${styles.effect} ${styles.effectTotal}`}>
        <span className={styles.effectLabel}>Against the budget</span>
        <span className={`${styles.effectValue} tabular ${styles[varianceTone(total)]}`}>
          {signed(total)}
        </span>
        <span className={styles.effectNote}>
          what the bar kept, less what it was budgeted to keep
        </span>
      </div>
    </div>
  )
}

function Sold({ detail: e }: { detail: BarDetail }) {
  if (e.sales.length === 0) {
    return (
      <p className={styles.note}>
        Closed by hand, so there is no product breakdown. Close it off the till and what sold, and
        what it did to the margin, appears here.
      </p>
    )
  }

  const rows = e.drag?.rows ?? e.sales.map((l) => ({ ...l, gp: null as number | null, effect: 0 }))

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Product</th>
              <th className={styles.num}>Units</th>
              <th className={styles.num}>Take</th>
              <th className={styles.num}>Stock cost</th>
              <th className={styles.num}>Margin</th>
              {e.drag ? <th className={styles.num}>Against budget</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const gp =
                r.costKnown && r.revenueEx > 0 ? (r.revenueEx - r.cost) / r.revenueEx : null
              return (
                <tr key={`${r.eposProductId ?? 'misc'}:${r.name}`}>
                  <td>
                    {r.name}
                    {r.category ? <span className={styles.cellSub}>{r.category}</span> : null}
                  </td>
                  <td className={`${styles.num} tabular`}>{Math.round(r.units * 10) / 10}</td>
                  <td className={`${styles.num} tabular`}>{money(r.revenue)}</td>
                  <td className={`${styles.num} tabular`}>
                    {r.costKnown ? (
                      money(r.cost)
                    ) : (
                      <span className={styles.warn}>no cost price</span>
                    )}
                  </td>
                  <td
                    className={`${styles.num} tabular ${gp === null ? '' : styles[marginTone(gp)]}`}
                  >
                    {gp === null ? '—' : pct(gp)}
                  </td>
                  {e.drag ? (
                    <td className={`${styles.num} tabular ${styles[varianceTone(r.effect)]}`}>
                      {signed(r.effect)}
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {e.drag && Math.abs(e.drag.residual) >= 1 ? (
        <p className={styles.note}>
          {signed(e.drag.residual)} of the margin is not on any one product — basket discounts,
          service charge and rounding.
        </p>
      ) : null}
      {e.drag && e.drag.missingCost > 0 ? (
        <p className={styles.warnNote}>
          {e.drag.missingCost} {e.drag.missingCost === 1 ? 'product has' : 'products have'} no cost
          price in Epos Now, so the margin reads richer than it was. Set the cost prices there.
        </p>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------- months ---

async function Months({ user }: { user: User }) {
  const { rows, rates, ahead } = await loadBarMonths(user)

  if (rows.length === 0) {
    return (
      <p className={styles.empty}>
        No confirmed nights in the last six months or ahead. Months fill in as events are confirmed.
      </p>
    )
  }

  return (
    <div className={styles.body}>
      <SectionHeading note="if the last three months keep going the way they have">
        The months ahead
      </SectionHeading>

      {rates && ahead ? (
        <div className={styles.callout}>
          <p>
            Read off {rates.nights} closed {rates.nights === 1 ? 'night' : 'nights'}: turnout ran at{' '}
            <b className="tabular">{pct(rates.turnout)}</b> of budget, spend per head at{' '}
            <b className="tabular">{pct(rates.spend)}</b>, and the margin after stock at{' '}
            <b className="tabular">{pct(rates.marginPct)}</b> against {pct(1 - CFG.stockCost)}{' '}
            budgeted.
          </p>
          <p>
            At those rates the {ahead.nights} {ahead.nights === 1 ? 'night' : 'nights'} still to
            come keep <b className="tabular">{money(ahead.reforecast)}</b> against the{' '}
            <b className="tabular">{money(ahead.planned)}</b> planned —{' '}
            <b className={`tabular ${styles[varianceTone(ahead.gap)]}`}>
              {money(Math.abs(ahead.gap))} {ahead.gap < 0 ? 'short' : 'ahead'}
            </b>
            .
          </p>
        </div>
      ) : (
        <p className={styles.note}>
          Not enough closed, budgeted nights with a counted door in the last three months to read a
          rate. The re-forecast appears once there are two.
        </p>
      )}

      <SectionHeading note="what the bar keeps after stock and its own labour">
        Budget, forecast and actual
      </SectionHeading>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Month</th>
              <th className={styles.num}>Nights</th>
              <th className={styles.num}>Budget</th>
              <th className={styles.num}>Forecast</th>
              <th className={styles.num}>Actual</th>
              <th className={styles.num}>Over / under</th>
              <th className={styles.num}>Running</th>
              <th>Mostly</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.key}>
                <th scope="row" className={styles.rowLabel}>
                  {m.label}
                </th>
                <td className={`${styles.num} tabular`}>
                  {m.closed}/{m.events}
                  <span className={styles.cellSub}>{m.budgeted} budgeted</span>
                </td>
                <td className={`${styles.num} tabular`}>
                  {money(m.budgetContribution)}
                  <span className={styles.cellSub}>{money(m.budgetTake)} take</span>
                </td>
                <td className={`${styles.num} tabular`}>
                  {money(m.forecastContribution)}
                  <span className={styles.cellSub}>{money(m.forecastTake)} take</span>
                </td>
                <td className={`${styles.num} tabular`}>
                  {m.closed ? money(m.actualContribution) : '—'}
                  {m.unbudgeted ? (
                    <span className={styles.cellSub}>{money(m.unbudgeted)} unbudgeted</span>
                  ) : null}
                </td>
                <td className={`${styles.num} tabular ${styles[varianceTone(m.variance)]}`}>
                  {m.variance === null ? '—' : signed(m.variance)}
                </td>
                <td className={`${styles.num} tabular ${styles[varianceTone(m.running)]}`}>
                  {signed(m.running)}
                </td>
                <td className={styles.driver}>{m.driver ? DRIVER_LABEL[m.driver] : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.footnote}>
        A night’s budget locks when it goes on sale, so over and under are measured against what was
        believed then, not a projection that has since been edited towards what happened. Forecast
        is the actual where a night has closed and today’s projection where it has not. Whether a
        good month is banked or held for the bar to ride out a thin one is a call for whoever runs
        the money — the running total is here to make it with.
      </p>
    </div>
  )
}
