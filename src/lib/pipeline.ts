/**
 * Pipeline derivations.
 *
 * Ported from `pipeVals()` in the design prototype
 * (docs/design-handoff/design/Pickle Prototype.dc.html, near line 3835), and
 * reworked on 16 September 2026 when each event's single stage became a
 * status per part — see src/lib/parts.ts. The prototype's eight-cell track
 * ticked off the stages behind an event and dashed out the ones ahead; the
 * same eight cells now say where each part stands on its own.
 *
 * Everything here is a pure function over a plain shape so it can be tested
 * without a database. Money never appears in this file: figures arrive
 * already computed by src/lib/finance.ts, which is the only place settlement
 * mathematics lives.
 */

import { hrs, money, days as dayLabel } from './format'
import { CFG } from './finance'
import { gatesDoneLabel } from './event-record'
import { PARTS, type BookingStatus, type PartKey, type PartState } from './parts'

export type RiskKind = 'warn' | 'stop'
export type StatusFilter = 'all' | 'mine' | 'risk' | 'soon' | 'done'
export type SortKey = 'door' | 'attention'

/**
 * How near a night has to be to count as soon: the "Next 30 days" filter, and
 * the horizon Home asks about unfinished work inside. One number, so the two
 * screens cannot disagree about what is coming up.
 */
export const SOON_DAYS = 30

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
  booking: BookingStatus
  /** Days until doors. Negative once the event is past. */
  daysToDoor: number
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
  /** Where each of the eight parts stands, in pipeline order. */
  parts: PartState[]
}

/** Whole days between two instants, by calendar day rather than by 24h. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86_400_000)
}

export const isAtRisk = (e: Pick<PipelineEvent, 'riskNote'>): boolean => e.riskNote !== null

/** `var(--st-stop)` for a stop-flag, `var(--st-warn)` otherwise. */
export const riskHue = (kind: RiskKind): string =>
  kind === 'stop' ? 'var(--st-stop)' : 'var(--st-warn)'

// ------------------------------------------------------------------ rows ---

/**
 * The hover text on a part's cell: where it stands, and what is in the way.
 * The cell has room for two words; this is where the rest goes.
 */
export function partTitle(p: PartState): string {
  const head = `${p.label}: ${p.status}${p.detail ? `, ${p.detail}` : ''}`
  // A part that is nothing to do yet — a settlement before the night — fails
  // its gates by definition, and listing them would read as a chase.
  if (p.checks.length === 0 || !p.applies) return head

  // Only the first letter comes down, so "Gather.rsvp" keeps its name.
  const inline = (label: string) => label.charAt(0).toLowerCase() + label.slice(1)
  const blocked = p.checks.filter((g) => !g.ok).map((g) => inline(g.label))
  return `${head}. ${gatesDoneLabel(p.checks)}${blocked.length ? ` — held up by ${blocked.join(', ')}` : ''}`
}

/**
 * How much on this event wants somebody. A part that is blocked counts twice
 * a part that is only asking, and the coordinator's own flag counts the same
 * way — so a denied licence outranks a stale listing, and a hand-written
 * "3 shifts unfilled, 8 days out" is never outranked by the arithmetic.
 *
 * This is what "time stuck" was for when an event sat in one stage. With
 * every part moving on its own there is no single clock to be stuck on, but
 * there is still a question of what to look at first.
 */
export function attentionOf(e: Pick<PipelineEvent, 'parts' | 'riskNote' | 'riskKind'>): number {
  const weight = (tone: string) => (tone === 'stop' ? 2 : tone === 'warn' ? 1 : 0)
  const flag = e.riskNote === null ? 0 : weight(e.riskKind)
  return e.parts.reduce((n, p) => n + weight(p.tone), flag)
}

export interface Projection {
  text: string
  tone: 'good' | 'muted' | 'dim'
}

/**
 * What the right-hand figure says. Before the booking is confirmed there is
 * nothing worth projecting, so it says so rather than showing a number built
 * on guesses.
 */
export function projection(
  e: Pick<PipelineEvent, 'concluded' | 'booking' | 'surplus' | 'actualTotal'>,
): Projection {
  if (e.concluded) return { text: `took ${money(e.actualTotal ?? 0)}`, tone: 'good' }
  if (e.booking !== 'confirmed') return { text: 'modelling', tone: 'dim' }
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
  sort: SortKey
  /** Initials of the signed-in person, for the "Mine" filter. */
  meInitials: string | null
}

/**
 * Filter and sort, reproducing the prototype's order of operations exactly.
 *
 * Note the quirk, kept deliberately: "Concluded" replaces the row set outright
 * rather than narrowing it, where every other status filter composes.
 *
 * The space chips are gone with the second room. They filtered on the room's
 * name, and with one bookable space every chip returned the same set — inert
 * controls that look like they do something. They come back when a second
 * room does, filtering on `spaceId` rather than on a name.
 */
export function pipelineRows(all: PipelineEvent[], f: RowFilters): PipelineEvent[] {
  const live = all.filter((e) => !e.concluded)
  let rows = live.slice()

  if (f.status === 'mine') rows = rows.filter((e) => e.ownerInitials === f.meInitials)
  if (f.status === 'risk') rows = rows.filter(isAtRisk)
  if (f.status === 'soon') rows = rows.filter((e) => e.daysToDoor <= SOON_DAYS)
  if (f.status === 'done') rows = all.filter((e) => e.concluded)

  rows.sort((x, y) =>
    f.sort === 'door'
      ? x.daysToDoor - y.daysToDoor
      : attentionOf(y) - attentionOf(x) || x.daysToDoor - y.daysToDoor,
  )
  return rows
}

export interface PartHead {
  key: PartKey
  label: string
  /** The stage nickname the part inherited, if it did. Hover text on the head. */
  nick: string | null
  /** Live events where this part is something to do and is not finished. */
  toGo: number
  /**
   * The count as the head prints it. A booking still to finish is one not yet
   * confirmed, and saying so beats "4 to go" (Connor, 22 Sep 2026).
   */
  count: string
}

/**
 * The column heads. Where the old heads counted the events sitting in each
 * stage, these count the events still to finish each part — an event is in
 * every column now, so a head that counted membership would say the same
 * number eight times.
 */
export function partHeads(all: PipelineEvent[]): PartHead[] {
  const live = all.filter((e) => !e.concluded)
  return PARTS.map((def) => {
    const toGo = live.filter((e) => {
      const p = e.parts.find((x) => x.key === def.key)
      return p !== undefined && p.applies && !p.done
    }).length
    return {
      key: def.key,
      label: def.label,
      nick: def.nick,
      toGo,
      count: def.key === 'booking' ? `${toGo} unconfirmed` : `${toGo} to go`,
    }
  })
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
  const confirmed = live.filter((e) => e.booking === 'confirmed').length

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
      note: `Any booking confirmed, however far along the rest is. We need roughly ${EVENTS_TO_COVER_BASE} to cover the fixed cost base`,
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
