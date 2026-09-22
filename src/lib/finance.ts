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

/**
 * 22 Sep 2026 — Connor set pay policy: contractors $35/h, employees $30/h
 * base. Not yet checked against a real settlement.
 */

/** House constants. */
export const CFG = {
  /** Base hourly rate, before on-costs. */
  rate: 30,
  /** On-costs applied to the base rate. */
  loadPct: 0.122,
  /** Loaded hourly rate: what an employee's hour costs the venue. */
  loaded: 33.66,
  /**
   * Standard payout per hour to a contractor: everyone who is not an
   * employee. Contractors carry no on-costs, so this is also what their hour
   * costs the venue.
   */
  contractorRate: 35,
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
  // Capacity is no longer here. It is a fact about a room, so it lives on the
  // `Space` row and is read by `capacityOf` in ticketing.ts. These three
  // constants had no reader once that moved, and the room they named — the
  // Apartment — is no longer bookable.
} as const

/** Paid a wage with on-costs, or a flat contractor rate with none. */
export type Employment = 'EMPLOYEE' | 'CONTRACTOR'

/** What an hour someone actually worked costs the venue. */
export function hourCost(employment: Employment): number {
  return employment === 'EMPLOYEE' ? CFG.loaded : CFG.contractorRate
}

/** What an hour someone actually worked pays them. */
export function payRate(employment: Employment): number {
  return employment === 'EMPLOYEE' ? CFG.rate : CFG.contractorRate
}

/**
 * What an hour costs the venue when nobody is assigned to it yet — a shift
 * plan, the bar's labour budget, the enquiry model, an unassigned roster
 * call. Everyone who is not an employee is a contractor, so an hour with no
 * name on it is costed as one.
 */
export const PLANNED_HOUR_COST = CFG.contractorRate

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
  /**
   * [subsidised, standard, supporter, door] — the order `avgTicket` below
   * reads, pairing `mix[0]` with `tiers().sub`. Named once in `MIX_LABELS`
   * (ticketing.ts), which explains why the order is worth stating.
   */
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
  /**
   * The blended cost per hour of the people actually on this event's hours —
   * set by `financeInputFor` from who is assigned, never worked out here.
   * Absent means nobody is known, so `ourPeople` falls back to
   * `PLANNED_HOUR_COST`.
   */
  hourCost?: number
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
  const ourPeople = hours * (e.hourCost ?? PLANNED_HOUR_COST)
  // The org-wide pool is not this event's people to attribute — always planned.
  const orgCost = e.orgShareHours * PLANNED_HOUR_COST

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
