import { describe, expect, it } from 'vitest'
import { CFG, PLANNED_HOUR_COST, financeVals, type FinanceEvent } from './finance'
import {
  BAR_ROLES,
  barBudgetFrom,
  barRefusal,
  driverLine,
  isBarRole,
  marginDrag,
  marginTone,
  monthRows,
  nightHasCome,
  nightFromActual,
  nightFromBudget,
  reforecast,
  serviceWindow,
  tillWindow,
  trailingRates,
  upcomingReforecast,
  varianceOf,
  varianceTone,
  type BarEventSummary,
  type SoldLine,
} from './bar'

/**
 * The bar, as three questions: what we think will happen, what happened and
 * why, and what that means for the months ahead.
 *
 * Nothing here is a second model of the bar. The budget is the settlement's
 * own bar line, frozen when the event goes on sale; the actual is the bar half
 * of the night's reconciliation. What this file adds is the arithmetic that
 * explains the gap between them — and that arithmetic has to be exact, because
 * "why" is only useful if the reasons add up to the difference.
 */

/** A night with a bill, a bar and crew — the same shape the settlement tests use. */
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
  artists: [{ low: 400, high: 900, status: 'confirmed' }],
  shifts: [{ hours: 40, assigned: true }],
  tasks: [],
  addons: [],
}

const vals = financeVals(event)
const budget = barBudgetFrom({ vals, barHead: event.barHead, labourHours: 11 })

describe('which shifts are the bar', () => {
  it('counts the duty manager and bar staff', () => {
    expect([...BAR_ROLES]).toEqual(['Duty manager', 'Bar staff'])
    expect(isBarRole('Duty manager')).toBe(true)
    expect(isBarRole('Bar staff')).toBe(true)
  })

  it('does not count the door, the crew or the sound desk', () => {
    expect(isBarRole('Door')).toBe(false)
    expect(isBarRole('Clean-up crew')).toBe(false)
    expect(isBarRole('Sound — Lead')).toBe(false)
  })
})

describe('serviceWindow', () => {
  it('opens the bar half an hour before doors', () => {
    expect(serviceWindow('8:00pm', '12:00am')).toEqual({
      opens: '7:30pm',
      closes: '12:00am',
      hours: 4.5,
    })
  })

  it('carries a close after midnight into the same night', () => {
    expect(serviceWindow('7:00pm', '1:00am').hours).toBe(6.5)
  })

  it('does not assume doors that nobody has set', () => {
    // The prototype defaulted to 8pm. A window invented for an event with no
    // doors would put the wrong sales against it.
    expect(serviceWindow(null, '12:00am')).toEqual({ opens: null, closes: '12:00am', hours: null })
  })

  it('has no length until the bar close is set', () => {
    expect(serviceWindow('8:00pm', null).hours).toBeNull()
  })
})

describe('tillWindow', () => {
  const night = new Date(2026, 8, 19, 12) // Sat 19 Sep 2026

  it('asks the till for the night as wall-clock time', () => {
    expect(tillWindow(night, '8:00pm', '1:00am')).toEqual({
      start: '2026-09-19T19:30:00',
      end: '2026-09-20T01:00:00',
    })
  })

  it('rolls a close after midnight into the next month when it has to', () => {
    expect(tillWindow(new Date(2026, 8, 30, 12), '9:00pm', '2:00am')!.end).toBe(
      '2026-10-01T02:00:00',
    )
  })

  it('cannot ask the till about a night with no doors or no bar close', () => {
    expect(tillWindow(night, null, '1:00am')).toBeNull()
    expect(tillWindow(night, '8:00pm', null)).toBeNull()
  })
})

describe('the budget', () => {
  /**
   * The load-bearing claim. The bar budget is not a second estimate of the
   * night: it is the settlement's own bar line at the moment the event went on
   * sale. If it were computed any other way, Bar and Finance would disagree
   * about what the same night was expected to make.
   */
  it('is the settlement’s bar line, not a second model', () => {
    expect(budget.heads).toBe(vals.att)
    expect(budget.margin).toBeCloseTo(vals.barMarg, 6)
    expect(nightFromBudget(budget).margin).toBeCloseTo(vals.barMarg, 6)
  })

  it('keeps the rates it was locked with, so a later change cannot rewrite it', () => {
    expect(budget.stockCostPct).toBe(CFG.stockCost)
    // Planned hours, nobody rostered yet — the contractor rate, not the loaded one.
    expect(budget.loadedRate).toBe(PLANNED_HOUR_COST)
  })

  it('prices the take off heads and spend per head, GST included', () => {
    const night = nightFromBudget(budget)
    expect(night.take).toBeCloseTo(200 * 16, 6)
    expect(night.takeEx).toBeCloseTo((200 * 16) / CFG.gst, 6)
    expect(night.stockCost + night.margin).toBeCloseTo(night.takeEx, 6)
  })

  it('takes the bar labour off at the rate it was locked with', () => {
    const night = nightFromBudget({ ...budget, loadedRate: 40 })
    expect(night.labour).toBeCloseTo(11 * 40, 6)
    expect(night.contribution).toBeCloseTo(night.margin - night.labour, 6)
  })
})

describe('an actual night', () => {
  it('reads the take and profit off the bar half and the heads off the door', () => {
    const night = nightFromActual({
      bar: { barTake: 2300, barProfit: 1150 },
      heads: 115,
      labourHours: 12,
    })
    expect(night.spendPerHead).toBeCloseTo(20, 6)
    expect(night.margin).toBe(1150)
    expect(night.stockCost).toBeCloseTo(2300 / CFG.gst - 1150, 6)
    expect(night.labour).toBeCloseTo(12 * PLANNED_HOUR_COST, 6)
  })

  it('has no spend per head until the door is counted', () => {
    const night = nightFromActual({
      bar: { barTake: 2300, barProfit: 1150 },
      heads: null,
      labourHours: 12,
    })
    expect(night.heads).toBeNull()
    expect(night.spendPerHead).toBeNull()
  })

  it('reads a bar that took nothing as a zero margin, not a NaN', () => {
    const night = nightFromActual({ bar: { barTake: 0, barProfit: 0 }, heads: 0, labourHours: 0 })
    expect(night.marginPct).toBe(0)
    expect(night.spendPerHead).toBeNull()
  })
})

/** A budgeted night of 200 at $16, and what actually happened. */
const planned = nightFromBudget(budget)
const happened = nightFromActual({
  bar: { barTake: 170 * 15, barProfit: ((170 * 15) / CFG.gst) * 0.55 },
  heads: 170,
  labourHours: 13,
})

describe('varianceOf', () => {
  /**
   * "Why" is only worth reading if the reasons add up to the difference. Each
   * effect is stated in what the bar keeps after stock and labour, and together
   * they are the whole gap — nothing is left over for a reader to wonder about.
   */
  it('splits the gap into reasons that add up to it exactly', () => {
    const v = varianceOf(planned, happened)
    const sum = Object.values(v.effects).reduce((a, b) => a + b, 0)

    expect(v.contributionVariance).toBeCloseTo(happened.contribution - planned.contribution, 6)
    expect(sum).toBeCloseTo(v.contributionVariance, 6)
  })

  it('puts fewer people through the door down to turnout', () => {
    const v = varianceOf(planned, happened)
    expect(v.effects.turnout).toBeLessThan(0)
    // 30 fewer people at the budgeted $16, at the budgeted margin, ex GST.
    expect(v.effects.turnout).toBeCloseTo(((-30 * 16) / CFG.gst) * planned.marginPct, 6)
  })

  it('puts each of them spending less down to spend per head', () => {
    const v = varianceOf(planned, happened)
    expect(v.effects.spend).toBeCloseTo(((-1 * 170) / CFG.gst) * planned.marginPct, 6)
  })

  it('puts a thinner margin down to the margin, not to the takings', () => {
    const v = varianceOf(planned, happened)
    expect(v.effects.rate).toBeCloseTo((0.55 - planned.marginPct) * happened.takeEx, 6)
  })

  it('counts two more bar hours against the night', () => {
    const v = varianceOf(planned, happened)
    expect(v.effects.labour).toBeCloseTo(-2 * PLANNED_HOUR_COST, 6)
  })

  it('cannot tell turnout from spend until the door is counted, and says so', () => {
    const uncounted = { ...happened, heads: null, spendPerHead: null }
    const v = varianceOf(planned, uncounted)

    expect(v.effects.turnout).toBe(0)
    expect(v.effects.spend).toBe(0)
    expect(v.effects.take).toBeCloseTo(
      ((happened.take - planned.take) / CFG.gst) * planned.marginPct,
      6,
    )
    expect(Object.values(v.effects).reduce((a, b) => a + b, 0)).toBeCloseTo(
      v.contributionVariance,
      6,
    )
  })

  it('names the reason that moved the night most', () => {
    const v = varianceOf(planned, happened)
    const biggest = (Object.entries(v.effects) as [string, number][]).sort(
      (a, b) => Math.abs(b[1]) - Math.abs(a[1]),
    )[0]![0]
    expect(v.driver).toBe(biggest)
  })

  it('names nothing when nothing moved', () => {
    expect(varianceOf(planned, planned).driver).toBeNull()
  })
})

describe('driverLine', () => {
  it('says what moved the night and which way', () => {
    const v = varianceOf(planned, happened)
    const line = driverLine(v)!
    expect(line).toMatch(/turnout|spend per head|margin|labour|takings/i)
    expect(line).toMatch(/under/)
  })

  it('says nothing when nothing moved', () => {
    expect(driverLine(varianceOf(planned, planned))).toBeNull()
  })
})

describe('marginDrag', () => {
  const lines: SoldLine[] = [
    {
      name: 'Pale ale',
      category: 'Tap',
      units: 100,
      revenue: 1100,
      revenueEx: 1100 / CFG.gst,
      cost: 385,
      costKnown: true,
    },
    {
      name: 'Spirits',
      category: 'Spirits',
      units: 60,
      revenue: 600,
      revenueEx: 600 / CFG.gst,
      cost: 138,
      costKnown: true,
    },
    {
      name: 'Soft drink',
      category: 'Low & no',
      units: 40,
      revenue: 180,
      revenueEx: 180 / CFG.gst,
      cost: 0,
      costKnown: false,
    },
  ]
  const takeEx = 1950 / CFG.gst // a little more than the lines: a basket discount and rounding
  const margin = takeEx - 523

  /**
   * The margin effect, split by what sold. A product dragging the margin down
   * is one selling below the margin the budget assumed; the effects plus what
   * cannot be put on a product (basket discounts, rounding) are the whole of it.
   */
  it('spreads the margin effect over what sold, exactly', () => {
    const d = marginDrag(lines, planned.marginPct, { takeEx, margin })
    const rate = margin - takeEx * planned.marginPct
    const total = d.rows.reduce((a, r) => a + r.effect, 0) + d.residual

    expect(total).toBeCloseTo(rate, 6)
  })

  it('works out each line’s own margin', () => {
    const d = marginDrag(lines, planned.marginPct, { takeEx, margin })
    const pale = d.rows.find((r) => r.name === 'Pale ale')!
    expect(pale.gp).toBeCloseTo((1100 / CFG.gst - 385) / (1100 / CFG.gst), 6)
  })

  it('flags a line with no cost price rather than calling it pure profit', () => {
    const d = marginDrag(lines, planned.marginPct, { takeEx, margin })
    const soft = d.rows.find((r) => r.name === 'Soft drink')!
    expect(soft.gp).toBeNull()
    expect(d.missingCost).toBe(1)
  })

  it('puts the biggest drag first', () => {
    const d = marginDrag(lines, planned.marginPct, { takeEx, margin })
    const effects = d.rows.map((r) => r.effect)
    expect(effects).toEqual([...effects].sort((a, b) => a - b))
  })
})

const summary = (over: Partial<BarEventSummary> & { date: Date }): BarEventSummary => ({
  id: over.id ?? over.date.toISOString(),
  name: over.name ?? 'A night',
  budget: planned,
  projection: planned,
  actual: null,
  ...over,
})

describe('monthRows', () => {
  const aug1 = summary({ id: 'a1', date: new Date(2026, 7, 8, 12), actual: happened })
  const aug2 = summary({
    id: 'a2',
    date: new Date(2026, 7, 22, 12),
    budget: null,
    actual: happened,
  })
  const sep1 = summary({ id: 's1', date: new Date(2026, 8, 12, 12) })
  const rows = monthRows([sep1, aug2, aug1])

  it('groups nights by the month they fall in, in date order', () => {
    expect(rows.map((r) => r.key)).toEqual(['2026-08', '2026-09'])
    expect(rows[0]!.label).toBe('Aug 2026')
    expect(rows[0]!.events).toBe(2)
  })

  it('sums locked budgets only, and actuals only for closed nights', () => {
    expect(rows[0]!.budgetContribution).toBeCloseTo(planned.contribution, 6)
    expect(rows[0]!.actualContribution).toBeCloseTo(happened.contribution * 2, 6)
    expect(rows[1]!.actualContribution).toBe(0)
  })

  it('forecasts off what happened where it has, and the projection where it has not', () => {
    expect(rows[0]!.forecastContribution).toBeCloseTo(happened.contribution * 2, 6)
    expect(rows[1]!.forecastContribution).toBeCloseTo(planned.contribution, 6)
  })

  /**
   * Variance is like for like. A night with no budget has nothing to be over
   * or under — it is counted as unbudgeted instead, because "we did a night we
   * never planned" is a reason in its own right, not noise in the variance.
   */
  it('compares only nights with both a budget and an actual', () => {
    expect(rows[0]!.variance).toBeCloseTo(happened.contribution - planned.contribution, 6)
    expect(rows[0]!.unbudgeted).toBeCloseTo(happened.contribution, 6)
    expect(rows[1]!.variance).toBeNull()
  })

  it('carries a running total of overs and unders through the months', () => {
    expect(rows[0]!.running).toBeCloseTo(rows[0]!.variance!, 6)
    expect(rows[1]!.running).toBeCloseTo(rows[0]!.running, 6)
  })

  it('names the reason that moved the month most', () => {
    expect(rows[0]!.driver).not.toBeNull()
    expect(rows[1]!.driver).toBeNull()
  })
})

describe('trailingRates and the re-forecast', () => {
  const now = new Date(2026, 9, 1, 12) // 1 Oct 2026

  const closed = (date: Date, heads: number, spend: number, marginPct: number) =>
    summary({
      date,
      actual: nightFromActual({
        bar: { barTake: heads * spend, barProfit: ((heads * spend) / CFG.gst) * marginPct },
        heads,
        labourHours: 11,
      }),
    })

  it('waits for two closed, budgeted, counted nights before reading a rate', () => {
    expect(trailingRates([closed(new Date(2026, 8, 5, 12), 180, 15, 0.56)], now)).toBeNull()
  })

  it('reads turnout, spend and margin off the recent nights against their budgets', () => {
    const r = trailingRates(
      [
        closed(new Date(2026, 8, 5, 12), 180, 15, 0.56),
        closed(new Date(2026, 8, 19, 12), 160, 14, 0.5),
      ],
      now,
    )!
    expect(r.nights).toBe(2)
    expect(r.turnout).toBeCloseTo(340 / 400, 6)
    expect(r.spend).toBeCloseTo((180 * 15 + 160 * 14) / 340 / 16, 6)
    const takeEx = (180 * 15 + 160 * 14) / CFG.gst
    const margin = ((180 * 15) / CFG.gst) * 0.56 + ((160 * 14) / CFG.gst) * 0.5
    expect(r.marginPct).toBeCloseTo(margin / takeEx, 6)
  })

  it('ignores nights older than the window', () => {
    const r = trailingRates(
      [
        closed(new Date(2026, 3, 5, 12), 10, 5, 0.1),
        closed(new Date(2026, 8, 5, 12), 180, 15, 0.56),
        closed(new Date(2026, 8, 19, 12), 160, 14, 0.5),
      ],
      now,
    )!
    expect(r.nights).toBe(2)
  })

  it('re-prices a planned night at those rates, keeping its labour', () => {
    const rates = { turnout: 0.85, spend: 0.9, marginPct: 0.5, nights: 3 }
    const re = reforecast(planned, rates)
    expect(re.heads).toBe(Math.round(200 * 0.85))
    expect(re.spendPerHead).toBeCloseTo(16 * 0.9, 6)
    expect(re.margin).toBeCloseTo(re.takeEx * 0.5, 6)
    expect(re.labour).toBeCloseTo(planned.labour, 6)
  })

  /**
   * The question a finance lead asks after a bad month: if it keeps going like
   * this, how big is the hole? Upcoming nights are held to their budget where
   * one is locked and their projection where not, then re-priced at recent
   * rates. Nights already past are not re-forecast — they have happened.
   */
  it('shows the hole across the nights still to come', () => {
    const rates = { turnout: 0.85, spend: 0.9, marginPct: 0.5, nights: 3 }
    const upcoming = [
      summary({ date: new Date(2026, 9, 10, 12) }),
      summary({ date: new Date(2026, 10, 7, 12), budget: null }),
      summary({ date: new Date(2026, 8, 26, 12) }), // past, not closed: not re-forecast
    ]
    const out = upcomingReforecast(upcoming, rates, now)
    expect(out.nights).toBe(2)
    expect(out.planned).toBeCloseTo(planned.contribution * 2, 6)
    expect(out.gap).toBeCloseTo(out.reforecast - out.planned, 6)
    expect(out.gap).toBeLessThan(0)
  })
})

describe('tones', () => {
  it('reads a margin the way the prototype colours it', () => {
    expect(marginTone(0.6)).toBe('good')
    expect(marginTone(0.4)).toBe('warn')
    expect(marginTone(0.2)).toBe('stop')
  })

  it('reads over as good, under as stop, and a rounding error as nothing', () => {
    expect(varianceTone(120)).toBe('good')
    expect(varianceTone(-120)).toBe('stop')
    expect(varianceTone(0.4)).toBe('plain')
    expect(varianceTone(null)).toBe('plain')
  })
})

describe('nightHasCome', () => {
  const night = new Date(2026, 8, 19, 12) // Sat 19 Sep

  it('refuses to close a bar on a night that has not happened', () => {
    expect(nightHasCome(night, new Date(2026, 8, 18, 23, 59))).toBe(false)
  })

  it('lets the bar close on the night itself, and after it', () => {
    expect(nightHasCome(night, new Date(2026, 8, 19, 9))).toBe(true)
    // Past midnight, closing the till for the night before.
    expect(nightHasCome(night, new Date(2026, 8, 20, 1, 30))).toBe(true)
  })
})

describe('barRefusal', () => {
  /**
   * The bar is the venue's. An outside coordinator has no business reading its
   * takings or its budget, and the months view has no event to scope them by —
   * so they are refused outright rather than filtered.
   */
  it('refuses an outside account', () => {
    expect(barRefusal({ external: true })).toMatch(/.+/)
  })

  it('lets anyone inside the venue through', () => {
    expect(barRefusal({ external: false })).toBeNull()
  })
})
