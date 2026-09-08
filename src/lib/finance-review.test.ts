import { describe, expect, it } from 'vitest'
import {
  approveLabel,
  riskText,
  flagRefusal,
  holdsMilestones,
  milestonesFor,
  reviewBlurb,
  reviewMilestone,
  type ReviewState,
} from './finance-review'

/**
 * The finance review, and the milestone ladder it governs.
 *
 * The load-bearing rules are that a red flag needs a reason and that a flagged
 * event cannot raise money. Both are asserted here rather than left to the
 * interface, because both are refusals — and a refusal that lives only in a
 * disabled button is not a refusal.
 */

describe('reviewMilestone', () => {
  it('sits before the deposit on a dry hire, and at confirmation on curator', () => {
    expect(reviewMilestone('dry')).toBe('before the 25% deposit invoice')
    expect(reviewMilestone('curator')).toBe('at booking confirmed, step 2')
  })
})

describe('reviewBlurb', () => {
  it('explains where the risk sits, differently per model', () => {
    expect(reviewBlurb('dry')).toContain('settles off the hire fee')
    expect(reviewBlurb('curator')).toContain('carries the downside')
  })
})

describe('approveLabel', () => {
  it('offers to clear the flag when there is one to clear', () => {
    expect(approveLabel('flagged')).toBe('Clear the flag and approve')
    expect(approveLabel('pending')).toBe('Approve it')
    expect(approveLabel('approved')).toBe('Approve it')
  })
})

describe('flagRefusal', () => {
  /**
   * The whole point of the reason. A bare flag tells a coordinator that
   * somebody is unhappy but not what would fix it, so an empty one is refused
   * rather than stored.
   */
  it('refuses a flag with no reason, in the words the coordinator will read', () => {
    expect(flagRefusal('')).toContain('Say what puts it at risk')
    expect(flagRefusal('   ')).toContain('Say what puts it at risk')
    expect(flagRefusal('\n\t ')).not.toBeNull()
  })

  it('allows a flag that says something', () => {
    expect(flagRefusal('the fee floor moved and the bar assumption is stale')).toBeNull()
  })
})

describe('holdsMilestones', () => {
  it('holds money only while flagged', () => {
    expect(holdsMilestones('flagged')).toBe(true)
    expect(holdsMilestones('pending')).toBe(false)
    expect(holdsMilestones('approved')).toBe(false)
  })
})

describe('milestonesFor', () => {
  const base = {
    stage: 4,
    depositRaised: false,
    invoiceRaised: false,
    review: 'approved' as ReviewState,
  }

  it('gives a dry hire the deposit then the balance', () => {
    expect(milestonesFor('dry', base).map((m) => m.key)).toEqual(['deposit', 'invoice'])
  })

  it('gives the curator model enquiry, confirmation, then settlement', () => {
    expect(milestonesFor('curator', base).map((m) => m.key)).toEqual(['enq', 'conf', 'invoice'])
  })

  it('treats the enquiry as always on record', () => {
    const enq = milestonesFor('curator', base).find((m) => m.key === 'enq')!
    expect(enq.done).toBe(true)
    expect(enq.action).toBeNull()
  })

  it('completes booking-confirmed at stage 2, and says who signs it off before then', () => {
    const before = milestonesFor('curator', { ...base, stage: 1 }).find((m) => m.key === 'conf')!
    expect(before.done).toBe(false)
    expect(before.note).toBe('not yet — finance signs off here')

    const after = milestonesFor('curator', { ...base, stage: 2 }).find((m) => m.key === 'conf')!
    expect(after.done).toBe(true)
  })

  it('offers to raise an unraised invoice and to reverse a raised one', () => {
    const unraised = milestonesFor('dry', base).find((m) => m.key === 'deposit')!
    expect(unraised.action).toBe('Raise it')

    const raised = milestonesFor('dry', { ...base, depositRaised: true }).find(
      (m) => m.key === 'deposit',
    )!
    expect(raised.action).toBe('Reverse')
    expect(raised.done).toBe(true)
  })

  /**
   * The rule the whole panel exists for. A flagged event can still be read,
   * but nothing on it can raise money until the flag clears.
   */
  it('withdraws the raise action on every money step while flagged', () => {
    const flagged = milestonesFor('dry', { ...base, review: 'flagged' })
    expect(flagged.filter((m) => m.action === 'Raise it')).toEqual([])
    expect(flagged.find((m) => m.key === 'deposit')!.heldByFlag).toBe(true)
  })

  it('still lets a raised milestone be reversed while flagged', () => {
    // Reversing takes money back off the table, which a flag should not block.
    const flagged = milestonesFor('dry', { ...base, depositRaised: true, review: 'flagged' })
    expect(flagged.find((m) => m.key === 'deposit')!.action).toBe('Reverse')
  })
})

describe('riskText', () => {
  const m = (n: number) => `$${Math.round(n)}`

  it('names the loss in money, not a percentage of nothing', () => {
    // A percentage of a loss is not a figure anybody can act on.
    expect(riskText('loss', -0.4, 1200, -480, m)).toBe('projected to run at a loss of $480')
  })

  it('states a thin margin as a percentage of the income it is thin against', () => {
    expect(riskText('thin', 0.05, 4000, 200, m)).toBe('thin — 5% on $4000 of income')
  })

  it('says the same of a healthy one', () => {
    expect(riskText('healthy', 0.22, 4000, 880, m)).toBe('healthy — 22% on $4000 of income')
  })
})
