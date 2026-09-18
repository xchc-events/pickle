import { describe, expect, it } from 'vitest'
import { CFG, financeVals, type FinanceEvent } from './finance'
import {
  cleanBar,
  cleanDoor,
  countedVals,
  halvesOf,
  isReconciled,
  takenOf,
  type ActualFigures,
} from './actuals'

/**
 * What a night counted, in two halves.
 *
 * The door and the bar are reconciled by different people off different
 * sources — the coordinator off Gather.rsvp, the bar manager off the till — so
 * each half goes in on its own. The settlement substitutes whichever halves
 * are in and leaves the rest projected, and the gate out of the event waits
 * for both.
 *
 * These tests exist because getting either half wrong moves the settlement
 * silently. A bar half that zeroed the ticket line, or a door half that
 * quietly kept the modelled bar margin, would put a wrong figure in front of
 * somebody who signs it.
 */

const row = (over: Partial<ActualFigures> = {}): ActualFigures => ({
  tickets: 118,
  ticketRev: 3009,
  barTake: 1974,
  barProfit: 1026,
  ...over,
})

describe('halvesOf', () => {
  it('has neither half when nothing has been reconciled', () => {
    expect(halvesOf(null)).toEqual({ door: null, bar: null })
  })

  it('reads both halves off a row that carries all four figures', () => {
    expect(halvesOf(row())).toEqual({
      door: { tickets: 118, ticketRev: 3009 },
      bar: { barTake: 1974, barProfit: 1026 },
    })
  })

  it('needs both door figures for the door to count as in', () => {
    // A head count with no revenue cannot price a ticket, and revenue with no
    // head count cannot say what anybody spent.
    expect(halvesOf(row({ ticketRev: null })).door).toBeNull()
    expect(halvesOf(row({ tickets: null })).door).toBeNull()
  })

  it('needs both bar figures for the bar to count as closed', () => {
    expect(halvesOf(row({ barProfit: null })).bar).toBeNull()
    expect(halvesOf(row({ barTake: null })).bar).toBeNull()
  })

  it('treats a zero as a figure, not as a missing one', () => {
    // A bar that took nothing is closed. Reading zero as "not in" would hold
    // the event at the gate forever for the night the bar never opened.
    const h = halvesOf(row({ barTake: 0, barProfit: 0 }))
    expect(h.bar).toEqual({ barTake: 0, barProfit: 0 })
  })

  it('keeps the halves independent', () => {
    const barOnly = halvesOf(row({ tickets: null, ticketRev: null }))
    expect(barOnly.door).toBeNull()
    expect(barOnly.bar).not.toBeNull()

    const doorOnly = halvesOf(row({ barTake: null, barProfit: null }))
    expect(doorOnly.door).not.toBeNull()
    expect(doorOnly.bar).toBeNull()
  })
})

describe('isReconciled', () => {
  it('is true only once both halves are in', () => {
    expect(isReconciled(halvesOf(row()))).toBe(true)
    expect(isReconciled(halvesOf(row({ barTake: null })))).toBe(false)
    expect(isReconciled(halvesOf(row({ tickets: null })))).toBe(false)
    expect(isReconciled(halvesOf(null))).toBe(false)
  })
})

describe('takenOf', () => {
  it('adds the ticket takings and the bar profit, as the prototype’s post-event total does', () => {
    expect(takenOf(halvesOf(row()))).toBe(3009 + 1026)
  })

  it('is nothing until both halves are in — half a night is not what it took', () => {
    expect(takenOf(halvesOf(row({ barProfit: null })))).toBeNull()
    expect(takenOf(halvesOf(row({ ticketRev: null })))).toBeNull()
    expect(takenOf(halvesOf(null))).toBeNull()
  })

  it('counts a night that took nothing as having taken nothing', () => {
    expect(takenOf(halvesOf(row({ ticketRev: 0, barTake: 0, barProfit: 0 })))).toBe(0)
  })
})

describe('cleanDoor', () => {
  it('accepts a counted door', () => {
    expect(cleanDoor({ tickets: 118, ticketRev: 3009 })).toEqual({
      ok: true,
      value: { tickets: 118, ticketRev: 3009 },
    })
  })

  it('accepts an empty room', () => {
    expect(cleanDoor({ tickets: 0, ticketRev: 0 }).ok).toBe(true)
  })

  it('refuses a negative figure rather than storing it as zero', () => {
    const out = cleanDoor({ tickets: -3, ticketRev: 3009 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toMatch(/negative/i)
    expect(cleanDoor({ tickets: 118, ticketRev: -1 }).ok).toBe(false)
  })

  it('refuses part of a person', () => {
    const out = cleanDoor({ tickets: 118.5, ticketRev: 3009 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toMatch(/whole/i)
  })

  it('refuses something that is not a number', () => {
    expect(cleanDoor({ tickets: Number.NaN, ticketRev: 3009 }).ok).toBe(false)
    expect(cleanDoor({ tickets: 118, ticketRev: Number.POSITIVE_INFINITY }).ok).toBe(false)
  })
})

describe('cleanBar', () => {
  it('accepts a closed bar', () => {
    expect(cleanBar({ barTake: 1974, barProfit: 1026 })).toEqual({
      ok: true,
      value: { barTake: 1974, barProfit: 1026 },
    })
  })

  it('refuses a negative figure', () => {
    expect(cleanBar({ barTake: -1, barProfit: 0 }).ok).toBe(false)
    expect(cleanBar({ barTake: 1974, barProfit: -5 }).ok).toBe(false)
  })

  /**
   * Profit after stock is what is left of the GST-exclusive take once the
   * stock is paid for. It cannot be more than that take, and a figure that is
   * almost always means the take was typed ex GST or the profit inc GST —
   * exactly the slip that moves a settlement without anybody noticing.
   */
  it('refuses more profit than the bar took, GST excluded', () => {
    const take = 1150
    const out = cleanBar({ barTake: take, barProfit: take / CFG.gst + 1 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.why).toMatch(/GST/)
  })

  it('accepts profit equal to the take ex GST — a night where stock cost nothing', () => {
    expect(cleanBar({ barTake: 1150, barProfit: 1150 / CFG.gst }).ok).toBe(true)
  })
})

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

describe('countedVals', () => {
  it('leaves the projection alone when nothing is counted', () => {
    expect(countedVals(vals, event.split, { door: null, bar: null })).toEqual(vals)
  })

  /**
   * The load-bearing case. Counting exactly what the model projected must
   * change nothing — so the counted arithmetic is provably the same arithmetic
   * finance.ts does, over different inputs, rather than a second version of it.
   */
  it('changes nothing when the counted night is exactly the projected one', () => {
    const counted = countedVals(vals, event.split, {
      door: { tickets: vals.att, ticketRev: vals.att * vals.avg },
      bar: { barTake: vals.att * event.barHead, barProfit: vals.barMarg },
    })

    for (const key of Object.keys(vals) as (keyof typeof vals)[]) {
      expect(counted[key], key).toBeCloseTo(vals[key], 6)
    }
  })

  it('takes the ticket line off the door when only the door is counted', () => {
    const counted = countedVals(vals, event.split, {
      door: { tickets: 150, ticketRev: 4500 },
      bar: null,
    })

    expect(counted.att).toBe(150)
    expect(counted.avg).toBeCloseTo(30, 6)
    expect(counted.ticketsEx).toBeCloseTo(4500 / CFG.gst, 6)
    // The bar is still the model's until somebody closes it.
    expect(counted.barMarg).toBeCloseTo(vals.barMarg, 6)
  })

  it('takes the bar line off the till when only the bar is closed', () => {
    const counted = countedVals(vals, event.split, {
      door: null,
      bar: { barTake: 2600, barProfit: 1350 },
    })

    expect(counted.barMarg).toBe(1350)
    // The door is still the model's, not zero. A bar closed before the door
    // is counted must not wipe the ticket line out of the settlement.
    expect(counted.att).toBe(vals.att)
    expect(counted.ticketsEx).toBeCloseTo(vals.ticketsEx, 6)
  })

  it('re-derives everything downstream of income, so the sheet still adds up', () => {
    const split = event.split
    const counted = countedVals(vals, split, {
      door: { tickets: 150, ticketRev: 4500 },
      bar: { barTake: 2600, barProfit: 1350 },
    })

    expect(counted.income).toBeCloseTo(counted.ticketsEx + counted.barMarg, 6)
    expect(counted.surplus).toBeCloseTo(counted.income - counted.fixed, 6)
    expect(counted.theirShare).toBeCloseTo(Math.max(0, counted.surplus) * split, 6)
    expect(counted.ours).toBeCloseTo(counted.surplus - counted.theirShare, 6)
  })

  it('does not touch the cost side — counting takings does not move a wage', () => {
    const counted = countedVals(vals, event.split, {
      door: { tickets: 10, ticketRev: 100 },
      bar: { barTake: 50, barProfit: 20 },
    })

    for (const key of [
      'base',
      'gear',
      'comps',
      'ourPeople',
      'orgCost',
      'floor',
      'fixed',
    ] as const) {
      expect(counted[key], key).toBe(vals[key])
    }
  })

  it('shares nothing out of a night that counted at a loss', () => {
    const counted = countedVals(vals, event.split, {
      door: { tickets: 10, ticketRev: 100 },
      bar: { barTake: 50, barProfit: 20 },
    })

    expect(counted.surplus).toBeLessThan(0)
    expect(counted.theirShare).toBe(0)
    expect(counted.ours).toBeCloseTo(counted.surplus, 6)
  })

  it('prices an empty door at nothing rather than dividing by zero', () => {
    const counted = countedVals(vals, event.split, {
      door: { tickets: 0, ticketRev: 0 },
      bar: null,
    })
    expect(counted.avg).toBe(0)
    expect(Number.isFinite(counted.ours)).toBe(true)
  })
})
