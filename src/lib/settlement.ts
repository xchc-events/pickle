import { CFG, type FinanceVals } from './finance'
import { hrs, money } from './format'

/**
 * The settlement P&L, as eleven display lines.
 *
 * This file computes no money. `financeVals` in src/lib/finance.ts is the
 * specification and already returned every figure below; all that happens here
 * is choosing which figure goes on which line, in the order the handoff gives,
 * and writing the sentence underneath it.
 *
 * Keeping it separate from finance.ts is deliberate. finance.ts is ported
 * line-for-line from the handoff and CLAUDE.md forbids reordering it for
 * presentation's sake — so presentation lives here, and the test asserts the
 * two cannot disagree.
 *
 * The one figure this file does derive is the GST held, which is a statement
 * about the gross takings rather than a term in the P&L: income is already
 * GST-exclusive by the time `financeVals` returns it.
 */

export type LineTone = 'plain' | 'income' | 'retained'

export interface SettlementLine {
  key: string
  label: string
  /** Always positive. `deduction` says whether it is taken away. */
  value: number
  note: string
  /** A rule is drawn above this line. Only income and retained carry one. */
  ruleAbove?: boolean
  tone: LineTone
  deduction: boolean
  /** The retained line, when the night cost us money. */
  negative: boolean
}

export interface SettlementContext {
  /** Day of the week the event falls on, for the cost base note. */
  dayName: string
  /** That day's share of the weekly cost base, 0–1. */
  dayShare: number
  /** How many people have hours against this event. */
  people: number
  /** The month the org-wide labour is pooled in, e.g. "Aug 2026". */
  month: string
  /** How many events share that month's org-wide labour. */
  monthEvents: number
  /** Names on the bill, declined acts excluded. */
  billNames: number
  /** Share of the surplus going to their people, 0–1. */
  split: number
  /**
   * Whether actuals are in. A projection and a settled night are different
   * claims and must not read the same — somebody signs the second one.
   */
  reconciled: boolean
  /** Assumed spend per head at the bar, GST inclusive — the handoff's $x/head. */
  barHead: number
  /** Gross ticket takings, GST inclusive, for the GST note only. */
  grossTickets: number
  /** Gross bar take, GST inclusive, for the GST note only. */
  grossBar: number
}

/**
 * The GST sitting inside a gross figure — `g − g / 1.15`, not `g × 0.15`.
 *
 * The venue holds this and hands it on; it is never income. It is stated on
 * the sheet because a settlement that shows only the ex-GST figure invites
 * somebody to ask where the rest of the door went.
 */
export function gstCollected(grossTickets: number, grossBar: number): number {
  const held = (gross: number) => gross - gross / CFG.gst
  return held(grossTickets) + held(grossBar)
}

const pct = (n: number): string => `${Math.round(n * 100)}%`

export function settlementLines(v: FinanceVals, ctx: SettlementContext): SettlementLine[] {
  const plain = (key: string, label: string, value: number, note: string): SettlementLine => ({
    key,
    label,
    value,
    note,
    tone: 'plain',
    deduction: false,
    negative: false,
  })

  const less = (key: string, label: string, value: number, note: string): SettlementLine => ({
    ...plain(key, label, value, note),
    deduction: true,
  })

  const counted = ctx.reconciled ? 'counted' : 'projected'

  return [
    plain(
      'tickets',
      'Tickets',
      v.ticketsEx,
      `${v.att} ${counted} at ${money(v.avg)} average, GST excluded`,
    ),
    plain(
      'bar',
      'Bar margin',
      v.barMarg,
      ctx.reconciled
        ? 'what the bar actually made after stock'
        : `${money(ctx.barHead)}/head at ${pct(CFG.barMargin)}, projected`,
    ),
    {
      ...plain('income', 'Income, GST exclusive', v.income, ''),
      note: `${money(gstCollected(ctx.grossTickets, ctx.grossBar))} of GST was collected and is held, not earned`,
      tone: 'income',
      ruleAbove: true,
    },
    less(
      'base',
      'Cost base share',
      v.base,
      `${ctx.dayName} carries ${pct(ctx.dayShare)} of the week — rent, power, insurance, software`,
    ),
    less(
      'gear',
      'Gear, hire & promotion',
      v.gear,
      v.wheke > 0
        ? `includes ${money(v.wheke)} to Wheke Sound on the sliding scale`
        : 'hire, backline and advertising booked to this event',
    ),
    less(
      'comps',
      'Comps & crew tokens',
      v.comps,
      `at stock cost of ${pct(CFG.stockCost)}, not till price`,
    ),
    less(
      'wages',
      'Crew wages, loaded',
      v.ourPeople,
      `${hrs(v.hours)} across ${ctx.people} ${ctx.people === 1 ? 'person' : 'people'} at ${money(CFG.loaded)} loaded`,
    ),
    less(
      'org',
      'Org-wide labour',
      v.orgCost,
      `this event's share of ${ctx.month}, spread across ${ctx.monthEvents} ${ctx.monthEvents === 1 ? 'event' : 'events'}`,
    ),
    less(
      'floor',
      'Artist & promoter floors',
      v.floor,
      `${ctx.billNames} ${ctx.billNames === 1 ? 'name' : 'names'} on the bill`,
    ),
    less(
      'share',
      'Surplus share out',
      v.theirShare,
      `${pct(ctx.split)} of the surplus to their people`,
    ),
    {
      ...plain('retained', 'Retained by PicklePicklePickle', v.ours, ''),
      note: v.ours < 0 ? 'this one costs us money' : 'back into the cost base',
      tone: 'retained',
      ruleAbove: true,
      negative: v.ours < 0,
    },
  ]
}
