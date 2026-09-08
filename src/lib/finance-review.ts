/**
 * The finance review, and the milestone ladder it governs.
 *
 * Ported from the prototype's `finRev` and `finSteps`
 * (docs/design-handoff/design/Pickle Prototype.dc.html, near line 5437). The
 * copy is specification and is reproduced verbatim — a coordinator reads these
 * sentences to find out why their booking is stuck.
 *
 * Two refusals live here rather than in the interface:
 *
 *   - A red flag without a reason is not a flag. A bare one tells a
 *     coordinator that somebody is unhappy and nothing about what would fix it.
 *   - A flagged event cannot raise money. That is the point of flagging: the
 *     deposit is held until the numbers move.
 *
 * Both are re-checked in the server action. A disabled button is a courtesy,
 * not a control.
 */

export type ReviewState = 'pending' | 'approved' | 'flagged'
export type BookingModelKey = 'dry' | 'curator'

/** Where the review sits on each path. Shown on the panel. */
export function reviewMilestone(model: BookingModelKey): string {
  return model === 'dry' ? 'before the 25% deposit invoice' : 'at booking confirmed, step 2'
}

/** Why the review sits there. Verbatim from the prototype. */
export function reviewBlurb(model: BookingModelKey): string {
  return model === 'dry'
    ? 'A dry hire settles off the hire fee, so the risk sits in the deposit. Finance sights the projection before the 25% goes out; a red flag holds the invoice and goes back to the coordinator.'
    : 'On the curator model the venue carries the downside, so this is where finance either signs the booking off or red-flags it. Step 1 is the enquiry, step 2 is the confirmation — nothing is confirmed on a flagged event until the numbers move.'
}

export function approveLabel(state: ReviewState): string {
  return state === 'flagged' ? 'Clear the flag and approve' : 'Approve it'
}

/**
 * Why a flag cannot be recorded, or null if it can.
 *
 * Returns the sentence the person flagging will read, not a boolean, so the
 * refusal and its wording cannot drift apart.
 */
export function flagRefusal(note: string): string | null {
  return note.trim().length === 0
    ? 'Say what puts it at risk — the coordinator sees your words, not a flag on its own.'
    : null
}

/** A flagged event holds its money milestones. Nothing else does. */
export const holdsMilestones = (state: ReviewState): boolean => state === 'flagged'

/**
 * What the margin indicator says. `marginHealth` in finance.ts decides which
 * of the three it is; this only writes the sentence, so the thresholds keep
 * one owner.
 */
export function riskText(
  health: 'loss' | 'thin' | 'healthy',
  margin: number,
  income: number,
  retained: number,
  money: (n: number) => string,
): string {
  if (health === 'loss') return `projected to run at a loss of ${money(Math.abs(retained))}`
  const pct = Math.round(margin * 100)
  return `${health} — ${pct}% on ${money(income)} of income`
}

export interface Milestone {
  key: 'deposit' | 'invoice' | 'enq' | 'conf'
  label: string
  note: string
  done: boolean
  /** 'Raise it' / 'Reverse', or null where the step is not actionable. */
  action: 'Raise it' | 'Reverse' | null
  /** True where a raise is withheld because the event is flagged. */
  heldByFlag: boolean
}

export interface MilestoneInput {
  stage: number
  depositRaised: boolean
  invoiceRaised: boolean
  review: ReviewState
}

export function milestonesFor(model: BookingModelKey, e: MilestoneInput): Milestone[] {
  const held = holdsMilestones(e.review)

  // Raising puts money on the table and is held by a flag; reversing takes it
  // back off, which a flag has no reason to block.
  const money = (
    key: 'deposit' | 'invoice',
    label: string,
    note: string,
    raised: boolean,
  ): Milestone => ({
    key,
    label,
    note,
    done: raised,
    action: raised ? 'Reverse' : held ? null : 'Raise it',
    heldByFlag: !raised && held,
  })

  if (model === 'dry') {
    return [
      money(
        'deposit',
        'Deposit invoice — 25%',
        e.depositRaised
          ? 'raised, the first milestone on a dry hire'
          : 'first milestone — 25% of the hire fee, on confirmation',
        e.depositRaised,
      ),
      money('invoice', 'Balance invoice', 'the rest, once the door count is in', e.invoiceRaised),
    ]
  }

  return [
    {
      key: 'enq',
      label: 'Booking enquiry',
      note: 'on record — the model runs off the enquiry figures',
      done: true,
      action: null,
      heldByFlag: false,
    },
    {
      key: 'conf',
      label: 'Booking confirmed',
      note:
        e.stage >= 2 ? 'confirmed and held in the calendar' : 'not yet — finance signs off here',
      done: e.stage >= 2,
      action: null,
      heldByFlag: false,
    },
    money('invoice', 'Settlement invoice', 'after the door count is in', e.invoiceRaised),
  ]
}
