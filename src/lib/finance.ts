/**
 * Settlement mathematics.
 *
 * Ported verbatim from the design handoff (docs/design-handoff/README.md,
 * "Finance mathematics — implement exactly"). Treat this file as a
 * specification, not an implementation detail: every figure the product shows
 * anywhere resolves back through here to hours logged against events and
 * prices set on the event record.
 *
 * Do not "tidy" the constants or reorder the P&L lines without a decision
 * recorded against the venue's own settlements.
 */

/** House constants. */
export const CFG = {
  /** Base hourly rate, before on-costs. */
  rate: 30,
  /** On-costs applied to the base rate. */
  loadPct: 0.122,
  /** Loaded hourly rate. Every wage figure uses this, never `rate`. */
  loaded: 33.66,
  /** NZ GST divisor. */
  gst: 1.15,
  /** Weekly fixed cost base — rent, power, insurance, software. */
  weekBase: 2457.37479261539,
  /** Bar gross margin. */
  barMargin: 0.598,
  /** Crew token face value. */
  tokenPrice: 15,
  /** Cost of goods — comps are charged at this, not at till price. */
  stockCost: 0.402,
  capMusic: 220,
  capSeated: 150,
  capApt: 40,
} as const

/** Day-of-week share of the weekly cost base. Unknown day falls back to 10%. */
export const COV: Record<number, number> = {
  0: 0.06, // Sun
  1: 0.04, // Mon
  2: 0.05, // Tue
  3: 0.05, // Wed
  4: 0.1, // Thu
  5: 0.4, // Fri
  6: 0.7, // Sat
}
export const COV_FALLBACK = 0.1

export type Scenario = 0 | 1 | 2 // quiet | likely | great

export interface FinanceArtist {
  status: 'enquired' | 'pencilled' | 'confirmed' | 'declined'
  low: number
  high: number
}

export interface FinanceAddon {
  kind: 'gear' | 'labour'
  cost?: number
  hours?: number
}

export interface FinanceShift {
  hours: number
  /** Only assigned shifts carry wage cost. */
  assigned: boolean
}

export interface FinanceTask {
  est: number
  actual?: number | null
}

export interface FinanceEvent {
  /** 0 = Sunday … 6 = Saturday. */
  dow: number
  std: number
  door: number
  /** [supporter, standard, subsidised, door]. */
  mix: [number, number, number, number]
  /** Attendance by scenario. */
  att: [number, number, number]
  scen: Scenario
  barHead: number
  gear: number
  adv: number
  sound?: string | null
  crew: number
  tok: number
  /** Share of surplus to their people, 0–1. */
  split: number
  artists: FinanceArtist[]
  shifts: FinanceShift[]
  tasks: FinanceTask[]
  addons: FinanceAddon[]
  /** Org-wide labour hours apportioned to this event for its month. */
  orgShareHours: number
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Wheke Sound sliding-scale fee, rounded to the nearest $25. */
export function whekeFee(income: number): number {
  const t = clamp((income - 3000) / 5000, 0, 1)
  return Math.round((300 + 300 * t) / 25) * 25
}

export function tiers(e: Pick<FinanceEvent, 'std' | 'door'>) {
  return {
    sub: Math.round(e.std * 0.8),
    std: e.std,
    sup: Math.round(e.std * 1.2),
    door: e.door,
  }
}

/** Average ticket price across the four-way mix. */
export function avgTicket(e: Pick<FinanceEvent, 'std' | 'door' | 'mix'>): number {
  const t = tiers(e)
  return t.sub * e.mix[0] + t.std * e.mix[1] + t.sup * e.mix[2] + t.door * e.mix[3]
}

/** Hours that carry wage cost: assigned shifts + logged tasks + addon labour. */
export function billableHours(e: FinanceEvent): number {
  const shiftHours = e.shifts.filter((s) => s.assigned).reduce((n, s) => n + s.hours, 0)
  const taskHours = e.tasks.reduce((n, t) => n + (t.actual ?? t.est), 0)
  const addonHours = e.addons
    .filter((a) => a.kind === 'labour')
    .reduce((n, a) => n + (a.hours ?? 0), 0)
  return shiftHours + taskHours + addonHours
}

export interface FinanceVals {
  avg: number
  att: number
  ticketsEx: number
  barMarg: number
  income: number
  base: number
  wheke: number
  gear: number
  comps: number
  hours: number
  ourPeople: number
  orgCost: number
  floor: number
  ceil: number
  fixed: number
  surplus: number
  theirShare: number
  /** Retained by PicklePicklePickle. Negative means the night costs us money. */
  ours: number
  theirTotal: number
  perHead: number
  breakeven: number
  fullPay: number
}

export function financeVals(e: FinanceEvent): FinanceVals {
  const avg = avgTicket(e)
  const att = e.att[e.scen]

  const ticketsEx = (att * avg) / CFG.gst
  const barMarg = ((att * e.barHead) / CFG.gst) * CFG.barMargin
  const income = ticketsEx + barMarg

  const base = CFG.weekBase * (COV[e.dow] ?? COV_FALLBACK)
  const wheke = e.sound === 'wheke' ? whekeFee(income) : 0
  const addonGear = e.addons.filter((a) => a.kind === 'gear').reduce((n, a) => n + (a.cost ?? 0), 0)
  const gear = e.gear + e.adv + wheke + addonGear

  const comps = e.crew * e.tok * CFG.tokenPrice * CFG.stockCost

  const hours = billableHours(e)
  const ourPeople = hours * CFG.loaded
  const orgCost = e.orgShareHours * CFG.loaded

  // Declined acts are off the bill and off the floor.
  const live = e.artists.filter((a) => a.status !== 'declined')
  const floor = live.reduce((n, a) => n + a.low, 0)
  const ceil = live.reduce((n, a) => n + a.high, 0)

  const fixed = base + gear + comps + ourPeople + orgCost + floor
  const surplus = income - fixed
  const theirShare = Math.max(0, surplus) * e.split
  const ours = surplus - theirShare
  const theirTotal = Math.min(ceil, floor + theirShare)

  const perHead = avg / CFG.gst + (e.barHead / CFG.gst) * CFG.barMargin
  const breakeven = Math.ceil(fixed / perHead)
  const fullPay = Math.ceil((fixed + (ceil - floor) / Math.max(e.split, 0.05)) / perHead)

  return {
    avg,
    att,
    ticketsEx,
    barMarg,
    income,
    base,
    wheke,
    gear,
    comps,
    hours,
    ourPeople,
    orgCost,
    floor,
    ceil,
    fixed,
    surplus,
    theirShare,
    ours,
    theirTotal,
    perHead,
    breakeven,
    fullPay,
  }
}

export type MarginHealth = 'loss' | 'thin' | 'healthy'

/**
 * What the finance review panel shows. A flagged event holds its milestone —
 * the deposit invoice on dry hire, booking-confirmed on the curator model.
 */
export function marginHealth(v: Pick<FinanceVals, 'income' | 'ours'>): {
  health: MarginHealth
  margin: number
} {
  const margin = v.income > 0 ? v.ours / v.income : 0
  if (v.ours < 0) return { health: 'loss', margin }
  if (margin < 0.08) return { health: 'thin', margin }
  return { health: 'healthy', margin }
}
