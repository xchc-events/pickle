import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { dateLabel, money } from './format'
import { financeVals, type Scenario } from './finance'
import { capacityOf, mixProblem, normaliseMix, paceOf, sellThrough, tierTable } from './ticketing'
import { STAGES } from './constants'
import type { SessionUser } from './session'

/**
 * Loads Ticketing.
 *
 * Every figure that involves money comes from `financeVals` in finance.ts,
 * which is specification. This file assembles what it needs and presents the
 * result — it does not do arithmetic on prices of its own, because the number
 * shown on this page and the number on the settlement have to be the same
 * number rather than two that agree today.
 */

export interface TicketTier {
  key: string
  label: string
  price: string
  share: string
  /** What this tier contributes to the average, at its share. */
  contributes: string
}

export interface TicketQueueRow {
  id: string
  name: string
  date: string
  sold: number
  capacity: number
  pct: number
  note: string
  tone: 'good' | 'warn' | 'stop' | 'plain'
  onSale: boolean
}

export interface TicketEvent {
  id: string
  name: string
  date: string
  spaceName: string
  format: string
  stage: number
  stageLabel: string
  onSale: boolean

  std: number
  door: number
  mix: number[]
  scen: Scenario
  sold: number
  capacity: number

  tiers: TicketTier[]
  /** Null when the mix is sound. */
  mixProblem: string | null
  average: string

  sellThroughPct: number
  breakeven: number
  breakevenPct: number
  fullPay: number
  fullPayPct: number

  projected: number
  projectedPct: number
  toBreakeven: number
  paceTone: 'good' | 'warn' | 'stop' | 'plain'
  paceNote: string

  /** The three attendance scenarios, and which is in use. */
  scenarios: { key: Scenario; label: string; att: number; revenue: string; on: boolean }[]
  revenue: string
}

export interface TicketingLoad {
  queue: TicketQueueRow[]
  event: TicketEvent | null
}

const SCENARIO_LABELS = ['Quiet', 'Likely', 'Great'] as const

/** The shape `financeVals` wants, assembled from a loaded event row. */
function financeInputFor(
  row: {
    date: Date
    std: number
    door: number
    mix: number[]
    att: number[]
    scen: number
    barHead: number
    gear: number
    adv: number
    sound: string | null
    crew: number
    tok: number
    split: number
    artists: { low: number; high: number; status: string }[]
    shifts: { hours: number; personId: string | null }[]
    tasks: { est: number; actual: number | null }[]
    addons: { kind: string; cost: number | null; hours: number | null }[]
  },
  scen: Scenario,
  orgShareHours: number,
) {
  return {
    dow: row.date.getDay(),
    std: row.std,
    door: row.door,
    mix: normaliseMix(row.mix),
    att: [row.att[0] ?? 0, row.att[1] ?? 0, row.att[2] ?? 0] as [number, number, number],
    scen,
    barHead: row.barHead,
    gear: row.gear,
    adv: row.adv,
    sound: row.sound,
    crew: row.crew,
    tok: row.tok,
    split: row.split,
    artists: row.artists.map((a) => ({
      low: a.low,
      high: a.high,
      status: a.status.toLowerCase() as 'enquired' | 'pencilled' | 'confirmed' | 'declined',
    })),
    shifts: row.shifts.map((s) => ({ hours: s.hours, assigned: s.personId !== null })),
    tasks: row.tasks.map((t) => ({ est: t.est, actual: t.actual })),
    addons: row.addons.map((a) => ({
      kind: a.kind.toLowerCase() as 'gear' | 'labour',
      cost: a.cost ?? undefined,
      hours: a.hours ?? undefined,
    })),
    orgShareHours,
  }
}

const EVENT_INCLUDE = {
  space: { select: { name: true } },
  artists: { select: { low: true, high: true, status: true } },
  shifts: { select: { hours: true, personId: true } },
  tasks: { select: { est: true, actual: true } },
  addons: { select: { kind: true, cost: true, hours: true } },
  channels: { where: { channel: 'gather' }, select: { live: true } },
} as const

export async function loadTicketing(
  user: SessionUser,
  wantedId: string | undefined,
): Promise<TicketingLoad> {
  // Confirmed onwards. Pricing an event that has not been agreed is pricing
  // a show that may not happen.
  const rows = await db.event.findMany({
    where: { AND: [{ stage: { gte: 2 }, concluded: false }, eventScope(user)] },
    orderBy: { date: 'asc' },
    include: EVENT_INCLUDE,
    take: 30,
  })

  const queue: TicketQueueRow[] = rows.map((e) => {
    const capacity = capacityOf(e.space.name, e.format)
    const pct = sellThrough(e.sold, capacity)
    const onSale = e.stage >= 4

    return {
      id: e.id,
      name: e.name,
      date: dateLabel(e.date),
      sold: e.sold,
      capacity,
      pct,
      onSale,
      note: onSale ? `${e.sold} of ${capacity}` : 'not on sale yet',
      tone: !onSale ? 'warn' : pct >= 70 ? 'good' : pct > 0 ? 'plain' : 'stop',
    }
  })

  const ids = rows.map((e) => e.id)
  const chosen = wantedId && ids.includes(wantedId) ? wantedId : (ids[0] ?? null)
  if (!chosen) return { queue, event: null }

  const row = rows.find((e) => e.id === chosen)!

  // Org-wide labour apportioned to this event's month, the same input the
  // Finance module uses. Kept simple here: the count of org hours that month
  // over the events in it.
  const monthStart = new Date(row.date.getFullYear(), row.date.getMonth(), 1)
  const monthEnd = new Date(row.date.getFullYear(), row.date.getMonth() + 1, 1)
  const [orgHours, eventsThatMonth] = await Promise.all([
    db.hourEntry.aggregate({
      where: { eventId: null, workedOn: { gte: monthStart, lt: monthEnd } },
      _sum: { hours: true },
    }),
    db.event.count({ where: { date: { gte: monthStart, lt: monthEnd } } }),
  ])
  const orgShareHours = eventsThatMonth > 0 ? (orgHours._sum.hours ?? 0) / eventsThatMonth : 0

  const scen = Math.min(2, Math.max(0, row.scen)) as Scenario
  const vals = financeVals(financeInputFor(row, scen, orgShareHours))
  const capacity = capacityOf(row.space.name, row.format)

  const table = tierTable(row.std, row.door, normaliseMix(row.mix))
  const pace = paceOf({ sold: row.sold, breakeven: vals.breakeven })

  return {
    queue,
    event: {
      id: row.id,
      name: row.name,
      date: dateLabel(row.date),
      spaceName: row.space.name,
      format: row.format,
      stage: row.stage,
      stageLabel: STAGES[row.stage] ?? '—',
      onSale: row.channels.some((c) => c.live),

      std: row.std,
      door: row.door,
      mix: row.mix,
      scen,
      sold: row.sold,
      capacity,

      tiers: table.map((t) => ({
        key: t.key,
        label: t.label,
        price: money(t.price),
        share: `${Math.round(t.share * 100)}%`,
        contributes: money(t.price * t.share),
      })),
      mixProblem: mixProblem(row.mix),
      average: money(vals.avg),

      sellThroughPct: sellThrough(row.sold, capacity),
      breakeven: vals.breakeven,
      breakevenPct: sellThrough(vals.breakeven, capacity),
      fullPay: vals.fullPay,
      fullPayPct: sellThrough(vals.fullPay, capacity),

      projected: pace.projected,
      projectedPct: sellThrough(pace.projected, capacity),
      toBreakeven: pace.toBreakeven,
      paceTone: pace.tone,
      paceNote: pace.note,

      scenarios: ([0, 1, 2] as Scenario[]).map((s) => {
        const att = row.att[s] ?? 0
        return {
          key: s,
          label: SCENARIO_LABELS[s],
          att,
          revenue: money(att * vals.avg),
          on: s === scen,
        }
      }),
      revenue: money(row.sold * vals.avg),
    },
  }
}
