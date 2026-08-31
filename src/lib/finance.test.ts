import { describe, expect, it } from 'vitest'
import {
  CFG,
  COV,
  avgTicket,
  billableHours,
  financeVals,
  marginHealth,
  tiers,
  whekeFee,
  type FinanceEvent,
} from './finance'

/** A plausible Friday music night, used as the base for each case. */
function makeEvent(over: Partial<FinanceEvent> = {}): FinanceEvent {
  return {
    dow: 5,
    std: 25,
    door: 30,
    mix: [0.15, 0.5, 0.2, 0.15],
    att: [80, 140, 200],
    scen: 1,
    barHead: 18,
    gear: 400,
    adv: 250,
    sound: null,
    crew: 6,
    tok: 2,
    split: 0.6,
    artists: [
      { status: 'confirmed', low: 600, high: 900 },
      { status: 'pencilled', low: 200, high: 350 },
    ],
    shifts: [
      { hours: 8, assigned: true },
      { hours: 6, assigned: true },
      { hours: 5, assigned: false },
    ],
    tasks: [
      { est: 4, actual: 6 },
      { est: 3, actual: null },
    ],
    addons: [
      { kind: 'gear', cost: 300 },
      { kind: 'labour', hours: 4 },
    ],
    orgShareHours: 12,
    ...over,
  }
}

describe('tiers', () => {
  it('derives every tier from the standard price', () => {
    expect(tiers({ std: 25, door: 30 })).toEqual({ sub: 20, std: 25, sup: 30, door: 30 })
  })

  it('rounds derived tiers rather than carrying cents', () => {
    expect(tiers({ std: 23, door: 30 })).toEqual({ sub: 18, std: 23, sup: 28, door: 30 })
  })
})

describe('avgTicket', () => {
  it('weights the four tiers by the mix', () => {
    // sub 20*0.15 + std 25*0.5 + sup 30*0.2 + door 30*0.15 = 3 + 12.5 + 6 + 4.5
    expect(avgTicket({ std: 25, door: 30, mix: [0.15, 0.5, 0.2, 0.15] })).toBeCloseTo(26, 10)
  })
})

describe('whekeFee', () => {
  it('floors at $300 below $3,000 of income', () => {
    expect(whekeFee(0)).toBe(300)
    expect(whekeFee(3000)).toBe(300)
  })

  it('ceilings at $600 once income passes $8,000', () => {
    expect(whekeFee(8000)).toBe(600)
    expect(whekeFee(20000)).toBe(600)
  })

  it('rounds to the nearest $25 on the slide', () => {
    const fee = whekeFee(5500)
    expect(fee % 25).toBe(0)
    expect(fee).toBeGreaterThan(300)
    expect(fee).toBeLessThan(600)
  })
})

describe('billableHours', () => {
  it('counts assigned shifts, actual-over-estimate task hours, and addon labour', () => {
    // shifts 8 + 6 (the unassigned 5 does not count)
    // tasks  6 (actual) + 3 (estimate, no actual yet)
    // addons 4
    expect(billableHours(makeEvent())).toBe(27)
  })

  it('ignores unassigned shifts — an open shift costs nothing yet', () => {
    const e = makeEvent({ shifts: [{ hours: 10, assigned: false }], tasks: [], addons: [] })
    expect(billableHours(e)).toBe(0)
  })
})

describe('financeVals', () => {
  it('builds income from tickets ex-GST plus bar margin', () => {
    const v = financeVals(makeEvent())
    expect(v.ticketsEx).toBeCloseTo((140 * 26) / CFG.gst, 6)
    expect(v.barMarg).toBeCloseTo(((140 * 18) / CFG.gst) * CFG.barMargin, 6)
    expect(v.income).toBeCloseTo(v.ticketsEx + v.barMarg, 6)
  })

  it('charges the day-of-week share of the weekly cost base', () => {
    expect(financeVals(makeEvent({ dow: 5 })).base).toBeCloseTo(CFG.weekBase * COV[5], 6)
    expect(financeVals(makeEvent({ dow: 1 })).base).toBeCloseTo(CFG.weekBase * COV[1], 6)
  })

  it('falls back to 10% of the cost base for an unknown day', () => {
    expect(financeVals(makeEvent({ dow: 9 })).base).toBeCloseTo(CFG.weekBase * 0.1, 6)
  })

  it('prices comps at stock cost, not till price', () => {
    // 6 crew * 2 tokens * $15 face * 40.2% cost of goods
    expect(financeVals(makeEvent()).comps).toBeCloseTo(6 * 2 * 15 * 0.402, 6)
  })

  it('adds the Wheke fee to gear only when Wheke is on the job', () => {
    const without = financeVals(makeEvent({ sound: null }))
    const withWheke = financeVals(makeEvent({ sound: 'wheke' }))
    expect(without.wheke).toBe(0)
    expect(withWheke.wheke).toBeGreaterThan(0)
    expect(withWheke.gear - without.gear).toBeCloseTo(withWheke.wheke, 6)
  })

  it('drops declined acts from the fee floor and ceiling', () => {
    const e = makeEvent({
      artists: [
        { status: 'confirmed', low: 600, high: 900 },
        { status: 'declined', low: 5000, high: 9000 },
      ],
    })
    const v = financeVals(e)
    expect(v.floor).toBe(600)
    expect(v.ceil).toBe(900)
  })

  it('pays wages at the loaded rate, never the base rate', () => {
    const v = financeVals(makeEvent())
    expect(v.ourPeople).toBeCloseTo(v.hours * CFG.loaded, 6)
    expect(v.orgCost).toBeCloseTo(12 * CFG.loaded, 6)
  })

  it('splits only a positive surplus — a loss is carried by the venue alone', () => {
    const loss = financeVals(makeEvent({ att: [10, 10, 10] }))
    expect(loss.surplus).toBeLessThan(0)
    expect(loss.theirShare).toBe(0)
    expect(loss.ours).toBeCloseTo(loss.surplus, 6)
  })

  it('caps their total at the agreed ceiling', () => {
    const v = financeVals(makeEvent({ att: [400, 400, 400], split: 0.9 }))
    expect(v.theirTotal).toBeLessThanOrEqual(v.ceil)
  })

  it('breaks even where per-head income covers the fixed base', () => {
    const v = financeVals(makeEvent())
    expect(v.breakeven).toBe(Math.ceil(v.fixed / v.perHead))
    expect(v.fullPay).toBeGreaterThanOrEqual(v.breakeven)
  })

  it('retains everything above the floor once the split is zero', () => {
    const v = financeVals(makeEvent({ split: 0 }))
    expect(v.theirShare).toBe(0)
    expect(v.ours).toBeCloseTo(v.surplus, 6)
  })
})

describe('marginHealth', () => {
  it('calls a negative retained figure a loss', () => {
    expect(marginHealth({ income: 5000, ours: -200 }).health).toBe('loss')
  })

  it('calls anything under 8% thin', () => {
    expect(marginHealth({ income: 5000, ours: 300 }).health).toBe('thin')
  })

  it('calls 8% or more healthy', () => {
    expect(marginHealth({ income: 5000, ours: 400 }).health).toBe('healthy')
  })

  it('treats a zero-income event as thin rather than dividing by zero', () => {
    const r = marginHealth({ income: 0, ours: 0 })
    expect(r.margin).toBe(0)
    expect(r.health).toBe('thin')
  })
})
