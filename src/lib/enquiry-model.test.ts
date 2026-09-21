import { describe, expect, it } from 'vitest'
import { isLate } from './event-record'
import { money } from './format'
import { COV, COV_FALLBACK, financeVals, marginHealth } from './finance'
import { HOUSE_TASKS } from './intake'
import { nightOf } from './night'
import { shiftPlan } from './roster'
import { modelOf, verdictOf, type ModelInputs } from './enquiry-model'

/**
 * The live model behind the enquiry form.
 *
 * Every dollar assertion here cross-checks `financeVals` — or `shiftPlan` or
 * `marginHealth` — called directly with the equivalent input, never a
 * hand-worked figure. The whole point of `modelOf` is that it cannot show a
 * promoter a number `financeVals` itself would not stand behind, and a test
 * with its own arithmetic could drift from that without ever failing.
 */

/** Saturday 3 October 2026 — day 6, the same night intake.test.ts books. */
const SATURDAY = nightOf(2026, 9, 3)
const SPACE = { name: 'Main', capacity: 220, seatedCapacity: 150 }

const inputs = (over: Partial<ModelInputs> = {}): ModelInputs => ({
  date: SATURDAY,
  space: SPACE,
  kind: 'live',
  format: 'Live music',
  barClose: '1:00am',
  std: 25,
  door: 30,
  mix: [0.2, 0.4, 0.15, 0.25],
  att: [88, 136, 198],
  barHead: 20,
  gear: 200,
  adv: 100,
  sound: 'inhouse',
  crew: 6,
  tok: 2,
  split: 0.6,
  acts: [
    { low: 400, high: 900 },
    { low: 250, high: 500 },
  ],
  ...over,
})

describe('modelOf', () => {
  it('builds exactly the FinanceEvent financeVals itself would read', () => {
    const plan = shiftPlan({
      space: SPACE,
      format: 'Live music',
      kind: 'live',
      att: [88, 136, 198],
      lateBar: isLate('1:00am'),
    })
    const expected = financeVals({
      dow: SATURDAY.getUTCDay(),
      std: 25,
      door: 30,
      mix: [0.2, 0.4, 0.15, 0.25],
      att: [88, 136, 198],
      scen: 1,
      barHead: 20,
      gear: 200,
      adv: 100,
      sound: 'inhouse',
      crew: 6,
      tok: 2,
      split: 0.6,
      artists: [
        { status: 'enquired', low: 400, high: 900 },
        { status: 'enquired', low: 250, high: 500 },
      ],
      shifts: plan.map((s) => ({ hours: s.hours, assigned: true })),
      tasks: HOUSE_TASKS.map((t) => ({ est: t.est })),
      addons: [],
      orgShareHours: 0,
    })

    expect(modelOf(inputs(), 1).vals).toEqual(expected)
  })

  it('reads the day of week from the date in UTC — Saturday is day 6, share 0.7', () => {
    expect(SATURDAY.getUTCDay()).toBe(6)
    const model = modelOf(inputs({ date: SATURDAY }), 1)
    expect(model.dayName).toBe('Saturday')
    expect(model.dayShare).toBe(COV[6])
    expect(model.dayShare).toBe(0.7)
  })

  it('falls back to COV_FALLBACK when no date has been picked yet', () => {
    const model = modelOf(inputs({ date: null }), 1)
    expect(model.dayShare).toBe(COV_FALLBACK)
  })

  it('crews the night from the standard plan, every shift assigned', () => {
    const plan = shiftPlan({
      space: SPACE,
      format: 'Live music',
      kind: 'live',
      att: [88, 136, 198],
      lateBar: isLate('1:00am'),
    })
    const model = modelOf(inputs(), 1)
    expect(model.crew).toEqual(plan.map((s) => ({ role: s.role, hours: s.hours })))
    expect(model.crewHours).toBe(plan.reduce((n, s) => n + s.hours, 0))
  })

  it('reads whether the bar runs late from isLate(barClose), same as the roster does', () => {
    const early = modelOf(inputs({ barClose: '11:00pm' }), 1)
    const plan = shiftPlan({
      space: SPACE,
      format: 'Live music',
      kind: 'live',
      att: [88, 136, 198],
      lateBar: isLate('11:00pm'),
    })
    expect(early.crew).toEqual(plan.map((s) => ({ role: s.role, hours: s.hours })))
  })

  it("adds HOUSE_TASKS' off-site hours on top of the on-site plan", () => {
    const model = modelOf(inputs(), 1)
    const taskHours = HOUSE_TASKS.reduce((n, t) => n + t.est, 0)
    expect(model.taskHours).toBe(taskHours)
    expect(model.vals.hours).toBe(model.crewHours + taskHours)
  })

  it('counts every act on the floor and the ceiling', () => {
    const model = modelOf(inputs(), 1)
    expect(model.vals.floor).toBe(400 + 250)
    expect(model.vals.ceil).toBe(900 + 500)
  })

  it('lets the scenario pick which attendance figure is used', () => {
    expect(modelOf(inputs(), 0).vals.att).toBe(88)
    expect(modelOf(inputs(), 1).vals.att).toBe(136)
    expect(modelOf(inputs(), 2).vals.att).toBe(198)
  })

  it('reads health and margin from marginHealth(vals), not its own arithmetic', () => {
    const model = modelOf(inputs(), 1)
    expect({ health: model.health, margin: model.margin }).toEqual(marginHealth(model.vals))
  })
})

describe('verdictOf', () => {
  it('stops on a night that loses money on a likely turnout', () => {
    const model = modelOf(inputs(), 1)
    expect(model.vals.surplus).toBeLessThan(0)
    expect(verdictOf(model)).toEqual({
      tone: 'stop',
      text: `On a likely turnout this night is ${money(-model.vals.surplus)} short of paying everybody’s floor and our crew. Raise the ticket price, expect more people, add bar spend, or trim the costs.`,
    })
  })

  it('warns on a night that is thin', () => {
    const model = modelOf(inputs({ att: [110, 160, 200], std: 32, door: 30, barHead: 22 }), 1)
    expect(model.health).toBe('thin')
    expect(model.vals.surplus).toBeGreaterThanOrEqual(0)
    expect(verdictOf(model)).toEqual({
      tone: 'warn',
      text: `On a likely turnout it pays everybody, with ${money(model.vals.surplus)} left — thin. One quiet night and it does not.`,
    })
  })

  it('gives the all-clear on a healthy night', () => {
    const model = modelOf(inputs({ att: [140, 200, 220], std: 45, door: 40, barHead: 30 }), 1)
    expect(model.health).toBe('healthy')
    expect(verdictOf(model)).toEqual({
      tone: 'good',
      text: `On a likely turnout it pays everybody’s floor and our crew in full, with ${money(model.vals.surplus)} left to share.`,
    })
  })
})
