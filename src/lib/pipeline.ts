/**
 * Pipeline derivations.
 *
 * Ported from `pipeVals()` in the design prototype
 * (docs/design-handoff/design/Pickle Prototype.dc.html, near line 3835).
 *
 * Everything here is a pure function over a plain shape so it can be tested
 * without a database. Money never appears in this file: figures arrive
 * already computed by src/lib/finance.ts, which is the only place settlement
 * mathematics lives.
 */

import { STAGES, STAGE_TARGET } from './constants'
import { hrs, money, days as dayLabel } from './format'
import { CFG } from './finance'

export type RiskKind = 'warn' | 'stop'
export type SpaceFilter = 'all' | 'main' | 'apt'
export type StatusFilter = 'all' | 'mine' | 'risk' | 'soon' | 'done'
export type SortKey = 'door' | 'stuck'

/** One event, flattened for the pipeline. */
export interface PipelineEvent {
  id: string
  name: string
  /** "Kōura Records", or "internal · Ana Kelliher". */
  promoter: string
  /** Display label: "Live music", "DJs", "Cabaret", "DJs + live". */
  format: string
  spaceName: string
  concluded: boolean
  /** 0 enquiry … 7 payout. */
  stage: number
  /** Days until doors. Negative once the event is past. */
  daysToDoor: number
  /** Days the event has sat in its current stage. */
  daysInStage: number
  /** The coordinator's own words for why this is flagged. Null = not at risk. */
  riskNote: string | null
  riskKind: RiskKind
  ownerInitials: string | null
  ownerName: string | null
  /** The one accented avatar — the prototype accents Mere Tapu. */
  ownerAccent: boolean
  extCoordInitials: string | null
  extCoordName: string | null
  /** From financeVals(e).ours — projected surplus retained. */
  surplus: number
  /** Actual take once concluded: ticketRev + barProfit. */
  actualTotal: number | null
  /** From financeVals(e).hours — assigned shifts + tasks + addon labour. */
  hours: number
  /** Off-site task hours by team, for the labour breakdown. */
  taskHours: { team: string; hours: number }[]
  /** Assigned on-site shift hours. */
  onSiteHours: number
}

/** Whole days between two instants, by calendar day rather than by 24h. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86_400_000)
}

/**
 * The rule the stage targets encode: an event past its target has been sitting
 * too long and wants someone's attention. See the note on STAGE_TARGET — the
 * prototype stores the risk copy but this rule picks out exactly the same set.
 */
export function isPastStageTarget(stage: number, daysInStage: number): boolean {
  const target = STAGE_TARGET[stage] ?? 99
  return daysInStage > target
}

export const isAtRisk = (e: Pick<PipelineEvent, 'riskNote'>): boolean => e.riskNote !== null

/** `var(--st-stop)` for a stop-flag, `var(--st-warn)` otherwise. */
export const riskHue = (kind: RiskKind): string =>
  kind === 'stop' ? 'var(--st-stop)' : 'var(--st-warn)'

// ------------------------------------------------------------------ rows ---

export interface StageCell {
  /** '✓' for a stage already passed, 'Nd' for the current one, '' ahead. */
  text: string
  state: 'done' | 'current' | 'ahead'
}

/**
 * The eight-cell stage track on each row. Passed stages are ticked, the
 * current one carries its day count and picks up the risk colour, stages
 * ahead are dashed outlines.
 */
export function stageCells(
  stage: number,
  daysInStage: number,
  atRisk: boolean,
): (StageCell & { risky: boolean })[] {
  return STAGES.map((_, i) => {
    if (i < stage) return { text: '✓', state: 'done' as const, risky: false }
    if (i === stage) return { text: `${daysInStage}d`, state: 'current' as const, risky: atRisk }
    return { text: '', state: 'ahead' as const, risky: false }
  })
}

export interface Projection {
  text: string
  tone: 'good' | 'muted' | 'dim'
}

/**
 * What the right-hand figure says. Before terms are agreed there is nothing
 * worth projecting, so it says so rather than showing a number built on
 * guesses.
 */
export function projection(
  e: Pick<PipelineEvent, 'concluded' | 'stage' | 'surplus' | 'actualTotal'>,
): Projection {
  if (e.concluded) return { text: `took ${money(e.actualTotal ?? 0)}`, tone: 'good' }
  if (e.stage < 2) return { text: 'modelling', tone: 'dim' }
  return {
    text: `proj. ${money(e.surplus)}`,
    tone: e.surplus > 500 ? 'good' : 'muted',
  }
}

/** The meta line under the event name: the risk note wins when there is one. */
export function metaLine(e: PipelineEvent): string {
  return e.riskNote ?? `${e.promoter} · ${e.format} · ${e.spaceName}`
}

export interface RowFilters {
  status: StatusFilter
  space: SpaceFilter
  sort: SortKey
  /** Initials of the signed-in person, for the "Mine" filter. */
  meInitials: string | null
}

/**
 * Filter and sort, reproducing the prototype's order of operations exactly.
 *
 * Note the quirk, kept deliberately: "Concluded" replaces the row set outright
 * and so ignores the space chips, where every other status filter composes
 * with them.
 */
export function pipelineRows(all: PipelineEvent[], f: RowFilters): PipelineEvent[] {
  const live = all.filter((e) => !e.concluded)
  let rows = live.slice()

  if (f.status === 'mine') rows = rows.filter((e) => e.ownerInitials === f.meInitials)
  if (f.status === 'risk') rows = rows.filter(isAtRisk)
  if (f.status === 'soon') rows = rows.filter((e) => e.daysToDoor <= 30)
  if (f.space === 'main') rows = rows.filter((e) => e.spaceName.includes('Main'))
  if (f.space === 'apt') rows = rows.filter((e) => e.spaceName.includes('Apartment U1'))
  if (f.status === 'done') rows = all.filter((e) => e.concluded)

  rows.sort((x, y) =>
    f.sort === 'door' ? x.daysToDoor - y.daysToDoor : y.daysInStage - x.daysInStage,
  )
  return rows
}

/** Per-stage counts across the live pipeline, for the column heads. */
export function stageCounts(all: PipelineEvent[]): { label: string; count: number }[] {
  const live = all.filter((e) => !e.concluded)
  return STAGES.map((label, i) => ({ label, count: live.filter((e) => e.stage === i).length }))
}

// --------------------------------------------------------------- metrics ---

export interface Metric {
  label: string
  value: string
  sub: string
  note: string
  tone: 'warn' | 'stop' | 'good' | 'plain'
  /** True where the figure is not yet computed from real data. */
  placeholder?: boolean
}

/** How many confirmed events it takes to cover the fixed cost base. */
export const EVENTS_TO_COVER_BASE = 18

export function pipelineMetrics(all: PipelineEvent[]): Metric[] {
  const live = all.filter((e) => !e.concluded)
  const hours = live.reduce((a, e) => a + e.hours, 0)
  const confirmed = live.filter((e) => e.stage >= 2).length

  return [
    // These two want a median over the last 20 bookings, which needs stage
    // transition history we do not record yet. The prototype hard-codes them
    // and so, for now, do we — flagged rather than quietly presented as real.
    {
      label: 'How long a booking takes to confirm',
      note: 'From the enquiry landing to terms agreed — median of the last 20 bookings',
      value: '11 days',
      sub: 'we aim for 7',
      tone: 'warn',
      placeholder: true,
    },
    {
      label: 'How long from confirmed to on sale',
      note: 'Terms agreed to tickets live — this is where events lose their run-up',
      value: '9 days',
      sub: 'we aim for 4',
      tone: 'stop',
      placeholder: true,
    },
    {
      label: 'Labour booked to events this month',
      note: `Every rostered shift plus every hour entered against a task, at $${CFG.loaded} loaded`,
      value: hrs(hours),
      sub: money(hours * CFG.loaded),
      tone: 'plain',
    },
    {
      label: 'Events confirmed for the next 60 days',
      note: `Anything past terms-agreed. We need roughly ${EVENTS_TO_COVER_BASE} to cover the fixed cost base`,
      value: `${confirmed} of ${EVENTS_TO_COVER_BASE}`,
      sub: `covers ${Math.round((confirmed / EVENTS_TO_COVER_BASE) * 100)}% of the base`,
      tone: 'good',
    },
  ]
}

export interface LabourRow {
  label: string
  value: string
  cost: string
  /** 0–100, relative to the largest team. */
  widthPct: number
}

/**
 * Where the labour goes: off-site task hours by team, plus every assigned
 * on-site shift pooled as one line. Hours are costed at the loaded rate,
 * never the base rate.
 */
export function labourSplit(all: PipelineEvent[]): LabourRow[] {
  const live = all.filter((e) => !e.concluded)
  const teams = new Map<string, number>()

  for (const e of live) {
    for (const t of e.taskHours) teams.set(t.team, (teams.get(t.team) ?? 0) + t.hours)
    teams.set('On-site crew', (teams.get('On-site crew') ?? 0) + e.onSiteHours)
  }

  const max = Math.max(1, ...teams.values())
  return [...teams.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label,
      value: hrs(value),
      cost: money(value * CFG.loaded),
      widthPct: Math.round((value / max) * 100),
    }))
}

/** The sub-line under the page title. */
export function pipelineSubline(all: PipelineEvent[], shown: number): string {
  const live = all.filter((e) => !e.concluded)
  return `${live.length} events in progress · ${live.filter(isAtRisk).length} at risk · ${shown} shown`
}

export { dayLabel }
