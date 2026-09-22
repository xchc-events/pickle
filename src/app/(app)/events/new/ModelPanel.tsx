'use client'

import { useMemo, useState } from 'react'
import { PLANNED_HOUR_COST } from '@/lib/finance'
import { modelOf, verdictOf, type ModelInputs } from '@/lib/enquiry-model'
import { headsLine } from '@/lib/event-record'
import { hrs, money } from '@/lib/format'
import styles from './new.module.css'

/**
 * "What this night does" — the live panel beside the enquiry form.
 *
 * Recomputed from `ModelInputs` with `modelOf`, which is `financeVals` under
 * the hood — the same function the event record reads once a booking is
 * real, so nothing here is a preview of a different sum. The verdict banner
 * is always about the LIKELY scenario, whichever one the toggle is showing,
 * because that is the one the venue plans staffing and ticketing around.
 *
 * Drawn twice, and CSS shows one of them: a plain block in the side column
 * from 600px up, and under that a native <details> whose summary is the bar
 * pinned above the submit button. One <details> forced open by CSS was the
 * first attempt, and it rendered as an empty box: a closed <details> hides
 * its content with `content-visibility` on a pseudo-element of its own, which
 * no rule on a child can undo. Both copies are the same element tree from the
 * same three models, so there is nothing to keep in step by hand, and the one
 * not showing is `display: none`, so it is not read out either.
 */

const SCENARIOS = ['Quiet', 'Likely', 'Great'] as const

const TONE_CLASS = { good: 'toneGood', warn: 'toneWarn', stop: 'toneStop' } as const
const VERDICT_CLASS = { good: 'verdictGood', warn: 'verdictWarn', stop: 'verdictStop' } as const

const cls = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

/** Up to the first full stop — what the collapsed phone bar shows. */
function firstClause(text: string): string {
  const i = text.indexOf('. ')
  return i === -1 ? text : text.slice(0, i + 1)
}

function Row({
  label,
  value,
  note,
  tone,
  strong,
}: {
  label: string
  value: string
  note?: string
  tone?: 'good' | 'warn' | 'stop'
  strong?: boolean
}) {
  return (
    <div className={cls(styles.pnlRow, strong && styles.pnlStrong)}>
      <div className={styles.pnlLine}>
        <span className={styles.pnlLabel}>{label}</span>
        <span className={cls(styles.pnlFigure, tone && styles[TONE_CLASS[tone]], 'tabular')}>
          {value}
        </span>
      </div>
      {note ? <p className={styles.pnlNote}>{note}</p> : null}
    </div>
  )
}

export function ModelPanel({ inputs, external }: { inputs: ModelInputs; external: boolean }) {
  const [scen, setScen] = useState<0 | 1 | 2>(1)

  // financeVals is cheap, but there is no reason to run it for all three
  // scenarios again just because an unrelated bit of form state (a toast, a
  // pending flag) re-rendered this component.
  const models = useMemo(
    () => [modelOf(inputs, 0), modelOf(inputs, 1), modelOf(inputs, 2)] as const,
    [inputs],
  )
  const likely = models[1]
  const shown = models[scen]
  const verdict = verdictOf(likely)
  const hasDate = inputs.date !== null
  const t = shown.vals

  const body = (
    <div className={styles.panelBody}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>What this night does</h2>
        <p className={styles.panelSub}>
          {external
            ? 'Worked from what you have entered, with the usual crew for a night like this.'
            : 'The night fully crewed — what it costs when it runs.'}
        </p>
      </div>

      <div className={styles.scenToggle} role="group" aria-label="Scenario">
        {SCENARIOS.map((label, i) => (
          <button
            key={label}
            type="button"
            aria-pressed={scen === i}
            className={cls(styles.scenBtn, scen === i && styles.scenBtnActive)}
            onClick={() => setScen(i as 0 | 1 | 2)}
          >
            {label}
          </button>
        ))}
      </div>

      <p aria-live="polite" className={cls(styles.verdict, styles[VERDICT_CLASS[verdict.tone]])}>
        {verdict.text}
      </p>

      <div className={styles.pnl}>
        <Row label="Ticket income (ex GST)" value={money(t.ticketsEx)} />
        <Row label="Bar margin" value={money(t.barMarg)} />
        <Row label="Total" value={money(t.income)} strong />

        <Row
          label={`− ${shown.dayName}’s share of the week`}
          value={money(t.base)}
          note={
            hasDate
              ? `${Math.round(shown.dayShare * 100)}% of the weekly cost base`
              : 'pick a night — a Saturday carries 70%, a Tuesday 5%'
          }
        />
        <Row label="− Gear, promotion and sound" value={money(t.gear)} />
        <Row label="− Comps" value={money(t.comps)} />

        <div className={styles.pnlRow}>
          <div className={styles.pnlLine}>
            <span className={styles.pnlLabel}>− Our people</span>
            <span className={cls(styles.pnlFigure, 'tabular')}>{money(t.ourPeople)}</span>
          </div>
          <p className={styles.pnlNote}>
            {hrs(shown.crewHours)} on site + {hrs(shown.taskHours)} off site, planned at $
            {PLANNED_HOUR_COST}/hr
          </p>
          <details className={styles.crewDetails}>
            <summary>Roster ({shown.crew.length})</summary>
            <ul className={styles.crewList}>
              {shown.crew.map((c, i) => (
                <li key={i}>
                  <span>{c.role}</span>
                  <span className="tabular">{hrs(c.hours)}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>

        <Row label="− Their people’s floor" value={money(t.floor)} />
        <Row
          label="Surplus"
          value={money(t.surplus)}
          tone={t.surplus < 0 ? 'stop' : 'good'}
          strong
        />
        <Row label="Their share" value={money(t.theirShare)} />
        <Row label="Retained" value={money(t.ours)} />
      </div>

      <p className={styles.pnlNote}>
        Their people are paid {money(t.theirTotal)} of {money(t.ceil)}
      </p>
      <p className={styles.pnlNote}>{headsLine(t.fullPay, t.breakeven)}</p>
    </div>
  )

  return (
    <>
      <aside className={cls(styles.panel, styles.panelWide)} aria-label="What this night does">
        {body}
      </aside>

      <details className={cls(styles.panel, styles.panelNarrow)}>
        <summary className={styles.summaryBar}>
          <span className={styles.summaryText}>{firstClause(verdict.text)}</span>
          <span className={cls(styles.summaryFigure, 'tabular')}>{money(likely.vals.surplus)}</span>
          <i className="ph ph-caret-down" aria-hidden="true" />
        </summary>
        {body}
      </details>
    </>
  )
}
