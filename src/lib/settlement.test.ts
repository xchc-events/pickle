import { describe, expect, it } from 'vitest'
import { CFG, financeVals, type FinanceEvent, type FinanceVals } from './finance'
import { money } from './format'
import { gstCollected, settlementLines, type SettlementContext } from './settlement'

/**
 * The settlement P&L, as the handoff specifies it.
 *
 * Nothing here computes money. `financeVals` does that and is untouched
 * specification; this file only asserts that the eleven lines *display* what
 * it returned, in the order the handoff gives, and that they still add up.
 *
 * The load-bearing test is `reconciles against financeVals` at the bottom.
 * A settlement sheet whose lines do not sum to its own total is worse than no
 * settlement sheet, because somebody will sign it.
 */

const ctx: SettlementContext = {
  dayName: 'Saturday',
  dayShare: 0.7,
  people: 6,
  month: 'Aug 2026',
  monthEvents: 3,
  billNames: 2,
  split: 0.4,
  reconciled: false,
  barHead: 16,
  grossTickets: 5350,
  grossBar: 3200,
}

/** A night with a bill, a bar, crew and an org-labour share. */
const event: FinanceEvent = {
  dow: 6,
  std: 25,
  door: 35,
  mix: [0.15, 0.5, 0.2, 0.15],
  att: [60, 200, 240],
  scen: 1,
  barHead: 16,
  gear: 400,
  adv: 150,
  sound: null,
  crew: 8,
  tok: 2,
  split: 0.4,
  orgShareHours: 12,
  artists: [
    { low: 400, high: 900, status: 'confirmed' },
    { low: 250, high: 500, status: 'confirmed' },
  ],
  shifts: [{ hours: 40, assigned: true }],
  tasks: [{ est: 6, actual: 8 }],
  addons: [],
}

const vals = financeVals(event)
const lines = settlementLines(vals, ctx)
const byKey = (k: string) => lines.find((l) => l.key === k)!

describe('settlementLines', () => {
  it('returns the eleven lines the handoff specifies, in order', () => {
    expect(lines.map((l) => l.key)).toEqual([
      'tickets',
      'bar',
      'income',
      'base',
      'gear',
      'comps',
      'wages',
      'org',
      'floor',
      'share',
      'retained',
    ])
  })

  it('rules off above income and above retained, and nowhere else', () => {
    expect(lines.filter((l) => l.ruleAbove).map((l) => l.key)).toEqual(['income', 'retained'])
  })

  it('marks the seven middle lines as deductions and the rest as not', () => {
    expect(lines.filter((l) => l.deduction).map((l) => l.key)).toEqual([
      'base',
      'gear',
      'comps',
      'wages',
      'org',
      'floor',
      'share',
    ])
  })

  it('reads income as tickets plus bar margin', () => {
    expect(byKey('income').value).toBeCloseTo(byKey('tickets').value + byKey('bar').value, 6)
  })

  /**
   * The one that matters. Income minus every deduction must equal the retained
   * line, and the retained line must equal what finance.ts already decided —
   * so the sheet cannot drift from the specification behind it.
   */
  it('reconciles against financeVals', () => {
    const deducted = lines.filter((l) => l.deduction).reduce((n, l) => n + l.value, 0)

    expect(byKey('income').value - deducted).toBeCloseTo(byKey('retained').value, 6)
    expect(byKey('retained').value).toBeCloseTo(vals.ours, 6)
  })

  it('states the GST collected and held in the income note', () => {
    expect(byKey('income').note).toContain('GST')
    expect(byKey('income').note).toMatch(/\$[\d,]+/)
  })

  it('names the day and its share of the base on the cost base line', () => {
    expect(byKey('base').note).toContain('Saturday')
    expect(byKey('base').note).toContain('70%')
  })

  it('names the month and how many events carry it on the org labour line', () => {
    expect(byKey('org').note).toContain('Aug 2026')
    expect(byKey('org').note).toContain('3')
  })

  it('counts the names on the bill against the floor', () => {
    expect(byKey('floor').note).toContain('2')
  })

  it('states the assumed spend per head on the bar line, not the margin per head', () => {
    // The handoff's line 2 is "$x/head at 59.8%" — x is what a punter spends,
    // which is the input to the margin, not the margin itself.
    expect(byKey('bar').note).toContain(money(16))
  })

  it('states the split percentage on the surplus share line', () => {
    expect(byKey('share').note).toContain('40%')
  })

  it('tones the retained line by whether the night made money', () => {
    expect(byKey('retained').tone).toBe('retained')

    const loss = settlementLines({ ...vals, ours: -250 } as FinanceVals, ctx)
    expect(loss.find((l) => l.key === 'retained')!.negative).toBe(true)
    expect(byKey('retained').negative).toBe(false)
  })

  /**
   * A projection and a reconciled settlement are different claims and must not
   * read the same. Once actuals are in, the sheet stops saying "projected".
   */
  it('says the figures are projected until actuals are in', () => {
    expect(byKey('tickets').note).toMatch(/project/i)

    const done = settlementLines(vals, { ...ctx, reconciled: true })
    expect(done.find((l) => l.key === 'tickets')!.note).not.toMatch(/project/i)
  })
})

describe('gstCollected', () => {
  it('is the GST inside the gross takings, not a markup on top', () => {
    // $1,150 gross at 15% holds $150 of GST, not $172.50.
    expect(gstCollected(1150, 0)).toBeCloseTo(150, 6)
  })

  it('counts the bar as well as the door', () => {
    expect(gstCollected(1150, 1150)).toBeCloseTo(300, 6)
  })

  it('is nothing on a night that took nothing', () => {
    expect(gstCollected(0, 0)).toBe(0)
  })

  it('agrees with the divisor finance.ts uses', () => {
    const gross = 4025
    expect(gstCollected(gross, 0)).toBeCloseTo(gross - gross / CFG.gst, 6)
  })
})
