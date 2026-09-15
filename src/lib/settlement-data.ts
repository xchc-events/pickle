import 'server-only'
import { db } from './db'
import { financeVals } from './finance'
import { FINANCE_SELECT, financeInputFor, orgShareFor, scenarioOf } from './finance-input'
import { settlementLines, type SettlementLine } from './settlement'
import { countedVals, halvesOf, isReconciled } from './actuals'
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
 * Once actuals are in, the counted figures replace the projected ones — each
 * half on its own, because the door and the bar are reconciled separately.
 * They are substituted at the edge by `countedVals` rather than inside
 * `financeVals`, which stays the untouched specification: a settled night and a
 * projected one are the same arithmetic over different inputs.
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

/** Who reconciled one half of the night, when, and off what. */
export interface HalfStamp {
  by: string | null
  at: Date | null
  /** POS when the server read it off Epos Now; MANUAL when somebody typed it. */
  source: 'MANUAL' | 'POS' | null
}

export interface Settlement {
  lines: SettlementLine[]
  model: BookingModelKey
  review: ReviewPanel
  milestones: Milestone[]
  /** True once both halves are in — the whole sheet is counted, not projected. */
  reconciled: boolean
  /** The door half's attribution. Null until the door is counted. */
  door: HalfStamp | null
  /** The bar half's attribution. Null until the bar is closed. */
  bar: HalfStamp | null
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
  const halves = halvesOf(actual)
  const reconciled = isReconciled(halves)

  // A counted night is the same model with counted inputs. Attendance and the
  // average come off the door; the bar margin is what the bar actually made.
  // A half not yet in stays projected — see countedVals.
  const vals = financeVals(input)
  const counted = countedVals(vals, input.split, halves)

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
    ticketsCounted: halves.door !== null,
    barCounted: halves.bar !== null,
    barHead: row.barHead,
    grossTickets: halves.door ? halves.door.ticketRev : counted.att * counted.avg,
    // A projected bar is priced off the projected heads, not the counted door:
    // `financeVals` drew the bar margin line from `vals.att`, and the GST note
    // has to describe that same figure.
    grossBar: halves.bar ? halves.bar.barTake : vals.att * row.barHead,
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
    door:
      actual && halves.door
        ? {
            by: actual.doorReconciledBy,
            at: actual.doorReconciledAt,
            source: actual.doorSource,
          }
        : null,
    bar:
      actual && halves.bar
        ? { by: actual.barReconciledBy, at: actual.barReconciledAt, source: actual.barSource }
        : null,
  }
}

/** How many events share that month's org-wide labour. Mirrors `orgShareFor`. */
async function monthEventCount(date: Date): Promise<number> {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
  const n = await db.event.count({ where: { date: { gte: from, lt: to } } })
  return Math.max(1, n)
}
