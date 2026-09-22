import { describe, expect, it, vi } from 'vitest'
import { CFG } from './finance'
import { financeInputFor, scenarioOf, type FinanceRow } from './finance-input'

/**
 * financeInputFor's blend.
 *
 * Written before the fix: the bug it closes is that this blend used to be
 * worked out separately in event-record-data.ts, so the event record priced
 * an hour differently from the Pipeline, Home, the settlement and Ticketing —
 * all of which build their `FinanceEvent` here. `financeInputFor` is the one
 * place every caller shares, so this is the one place the blend has to live.
 *
 * finance-input.ts also carries `orgShareFor`, a database query, which is why
 * the file is `server-only` and why that import is stubbed out below — never
 * called here, and db.ts builds nothing at import time (see its own header),
 * so this stub is the only thing standing between `financeInputFor` and a
 * plain unit test.
 */
vi.mock('server-only', () => ({}))

/** A minimal row — just enough columns for financeInputFor to read. */
function makeRow(over: Partial<FinanceRow> = {}): FinanceRow {
  return {
    date: new Date('2026-10-03T00:00:00Z'),
    std: 25,
    door: 30,
    mix: [0.2, 0.4, 0.15, 0.25],
    att: [80, 140, 200],
    scen: 1,
    barHead: 18,
    gear: 400,
    adv: 250,
    sound: null,
    crew: 6,
    tok: 2,
    split: 0.6,
    artists: [],
    shifts: [],
    tasks: [],
    addons: [],
    ...over,
  }
}

describe('financeInputFor — the blended cost of an event’s hours', () => {
  it('blends assigned shifts at each person’s own rate, and planned hours (tasks, addon labour) at the contractor rate', () => {
    const row = makeRow({
      shifts: [
        { hours: 5, personId: 'p_employee', person: { employment: 'EMPLOYEE' } },
        { hours: 5, personId: 'p_contractor', person: { employment: 'CONTRACTOR' } },
      ],
      tasks: [{ est: 2, actual: null }],
    })

    const event = financeInputFor(row, scenarioOf(row.scen), 0)

    // (5 × 33.66 + 5 × 35 + 2 × 35) / 12
    expect(event.hourCost).toBeCloseTo(
      (5 * CFG.loaded + 5 * CFG.contractorRate + 2 * CFG.contractorRate) / 12,
      6,
    )
  })

  it('does not count an unassigned shift towards the blend — it carries no wage cost yet', () => {
    const row = makeRow({
      shifts: [
        { hours: 5, personId: 'p_employee', person: { employment: 'EMPLOYEE' } },
        { hours: 20, personId: null, person: null },
      ],
    })

    const event = financeInputFor(row, scenarioOf(row.scen), 0)

    // Only the 5 assigned hours are on it; the open 20h shift is nobody's yet.
    expect(event.hourCost).toBeCloseTo(CFG.loaded, 6)
  })

  it('costs an assigned shift with no person on file as a contractor, not free', () => {
    // A data gap — personId set but the join came back empty — still has to
    // cost something, and the standing rule is that everyone who is not a
    // named employee is a contractor.
    const row = makeRow({ shifts: [{ hours: 4, personId: 'p_gone', person: null }] })

    const event = financeInputFor(row, scenarioOf(row.scen), 0)

    expect(event.hourCost).toBeCloseTo(CFG.contractorRate, 6)
  })

  it('leaves hourCost undefined when there are no billable hours', () => {
    const row = makeRow({
      shifts: [{ hours: 10, personId: null, person: null }],
      tasks: [{ est: 0, actual: null }],
    })

    const event = financeInputFor(row, scenarioOf(row.scen), 0)

    expect(event.hourCost).toBeUndefined()
  })
})
