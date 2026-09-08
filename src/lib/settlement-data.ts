import 'server-only'
import { db } from './db'
import { CFG, financeVals } from './finance'
import { FINANCE_SELECT, financeInputFor, orgShareFor, scenarioOf } from './finance-input'
import { settlementLines, type SettlementLine } from './settlement'
import {
  approveLabel,
  milestonesFor,
  reviewBlurb,
  reviewMilestone,
  type BookingModelKey,
  type Milestone,
  type ReviewState,
} from './finance-review'
import { marginHealth, type MarginHealth } from './finance'
import { COV, COV_FALLBACK } from './finance'

/**
 * The settlement sheet for one event.
 *
 * Every figure comes through `financeInputFor` — the same assembly Ticketing
 * and the event record use — so the sheet cannot price a night differently
 * from the screens that set its price. That is the whole reason the assembly
 * was extracted; see src/lib/finance-input.ts.
 *
 * Once actuals are in, the counted figures replace the projected ones. They
 * are substituted at the edge here rather than inside `financeVals`, which
 * stays the untouched specification: a settled night and a projected one are
 * the same arithmetic over different inputs, not different arithmetic.
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const monthLabel = (d: Date): string =>
  d.toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' })

export interface ReviewPanel {
  state: ReviewState
  /** The flag reason, shown only while flagged. */
  note: string | null
  by: string | null
  when: Date | null
  /** Where the review sits on this path. */
  milestone: string
  blurb: string
  /** 'Approve it' / 'Clear the flag and approve'. */
  okLabel: string
  health: MarginHealth
  /** Retained over income, 0–1. */
  margin: number
  income: number
  retained: number
}

export interface Settlement {
  lines: SettlementLine[]
  model: BookingModelKey
  review: ReviewPanel
  milestones: Milestone[]
  /** True once an Actual row exists — the sheet is counted, not projected. */
  reconciled: boolean
  /** Who reconciled it and when, for the attribution line. */
  reconciledBy: string | null
  reconciledAt: Date | null
  /** MANUAL today; POS once a till is connected. */
  source: string | null
}

export async function settlementFor(eventId: string): Promise<Settlement | null> {
  const row = await db.event.findUnique({
    where: { id: eventId },
    select: {
      ...FINANCE_SELECT,
      id: true,
      actual: true,
      stage: true,
      model: true,
      depositRaisedAt: true,
      invoiceRaisedAt: true,
      review: true,
    },
  })
  if (!row) return null

  const orgShareHours = await orgShareFor(row.date)
  const input = financeInputFor(row, scenarioOf(row.scen), orgShareHours)

  const actual = row.actual
  const reconciled = actual != null

  // A counted night is the same model with counted inputs. Attendance and the
  // average come off the door; the bar margin is what the bar actually made.
  const vals = financeVals(input)
  const counted = reconciled
    ? {
        ...vals,
        att: actual.tickets,
        avg: actual.tickets > 0 ? actual.ticketRev / actual.tickets : 0,
        ticketsEx: actual.ticketRev / CFG.gst,
        barMarg: actual.barProfit,
      }
    : vals

  if (reconciled) {
    // Everything downstream of income moves with it, so re-derive rather than
    // leaving a sheet whose total contradicts its own lines.
    counted.income = counted.ticketsEx + counted.barMarg
    counted.surplus = counted.income - counted.fixed
    counted.theirShare = Math.max(0, counted.surplus) * input.split
    counted.ours = counted.surplus - counted.theirShare
  }

  const [people, monthEvents] = await Promise.all([
    db.hourEntry
      .findMany({ where: { eventId }, select: { personId: true }, distinct: ['personId'] })
      .then((rows) => rows.length),
    monthEventCount(row.date),
  ])

  const lines = settlementLines(counted, {
    dayName: DAY_NAMES[row.date.getDay()],
    dayShare: COV[row.date.getDay()] ?? COV_FALLBACK,
    people,
    month: monthLabel(row.date),
    monthEvents,
    billNames: input.artists.filter((a) => a.status !== 'declined').length,
    split: input.split,
    reconciled,
    barHead: row.barHead,
    grossTickets: reconciled ? actual.ticketRev : counted.att * counted.avg,
    grossBar: reconciled ? actual.barTake : counted.att * row.barHead,
  })

  const model: BookingModelKey = row.model === 'DRY' ? 'dry' : 'curator'
  const state = (row.review?.state ?? 'PENDING').toLowerCase() as ReviewState

  // The indicator reads off the *projection*, not the counted night, even once
  // actuals are in: the review is a decision taken before the money moves, and
  // re-scoring it against what happened would rewrite why it was made.
  const health = marginHealth(vals)

  return {
    lines,
    model,
    review: {
      state,
      note: row.review?.note ?? null,
      by: row.review?.by ?? null,
      when: row.review?.when ?? null,
      milestone: reviewMilestone(model),
      blurb: reviewBlurb(model),
      okLabel: approveLabel(state),
      health: health.health,
      margin: health.margin,
      income: vals.income,
      retained: vals.ours,
    },
    milestones: milestonesFor(model, {
      stage: row.stage,
      depositRaised: row.depositRaisedAt !== null,
      invoiceRaised: row.invoiceRaisedAt !== null,
      review: state,
    }),
    reconciled,
    reconciledBy: actual?.reconciledBy ?? null,
    reconciledAt: actual?.reconciledAt ?? null,
    source: actual?.source ?? null,
  }
}

/** How many events share that month's org-wide labour. Mirrors `orgShareFor`. */
async function monthEventCount(date: Date): Promise<number> {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
  const n = await db.event.count({ where: { date: { gte: from, lt: to } } })
  return Math.max(1, n)
}
