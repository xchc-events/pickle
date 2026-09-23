import { describe, expect, it } from 'vitest'
import { CFG, financeVals, type FinanceEvent } from './finance'
import {
  compsCountFor,
  groupDoorList,
  totalPeople,
  validateDoorListEntry,
  validPartySize,
  type DoorListRow,
} from './door-list'

/**
 * Comps are money: `compsCountFor` decides the one figure that reaches
 * `financeVals`'s `comps` line (src/lib/finance.ts) — the door list's COMP
 * entries, party sizes summed, once any exist for the event; the typed
 * `Event.crew` figure exactly as before until then. The last block proves
 * that through the real `financeVals`, not a stand-in for it, since that is
 * the number the settlement actually counts.
 */

const rowsOf = (
  kinds: { kind: DoorListRow['kind']; partySize: number }[],
): DoorListRow[] =>
  kinds.map((k, i) => ({
    id: `d${i}`,
    name: `Row ${i}`,
    partySize: k.partySize,
    kind: k.kind,
    note: null,
    who: 'Test',
    addedAt: new Date(),
    checkedIn: 0,
  }))

describe('compsCountFor', () => {
  it('reads the typed crew figure when the door list is empty', () => {
    expect(compsCountFor([], 6)).toBe(6)
  })

  it('reads the typed crew figure when nothing on the list is a comp', () => {
    const entries = [
      { kind: 'GUEST' as const, partySize: 2 },
      { kind: 'INDUSTRY' as const, partySize: 1 },
      { kind: 'ACT' as const, partySize: 4 },
    ]
    expect(compsCountFor(entries, 6)).toBe(6)
  })

  it('sums COMP party sizes once any exist, in place of the typed figure', () => {
    const entries = [
      { kind: 'COMP' as const, partySize: 2 },
      { kind: 'COMP' as const, partySize: 3 },
      { kind: 'GUEST' as const, partySize: 10 },
    ]
    expect(compsCountFor(entries, 6)).toBe(5)
  })

  it('counts a single comp entry by its own party size', () => {
    expect(compsCountFor([{ kind: 'COMP', partySize: 1 }], 6)).toBe(1)
  })
})

describe('totalPeople', () => {
  it('sums party sizes, not rows', () => {
    expect(totalPeople([{ partySize: 2 }, { partySize: 3 }, { partySize: 1 }])).toBe(6)
  })

  it('is 0 for no entries', () => {
    expect(totalPeople([])).toBe(0)
  })
})

describe('groupDoorList', () => {
  it('groups by kind in a fixed order, leaving out kinds with nothing on them', () => {
    const rows = rowsOf([
      { kind: 'ACT', partySize: 2 },
      { kind: 'GUEST', partySize: 1 },
      { kind: 'COMP', partySize: 3 },
    ])
    const groups = groupDoorList(rows)
    expect(groups.map((g) => g.kind)).toEqual(['GUEST', 'COMP', 'ACT'])
    expect(groups.find((g) => g.kind === 'COMP')?.people).toBe(3)
  })

  it('gives each group its own people total', () => {
    const rows = rowsOf([
      { kind: 'GUEST', partySize: 2 },
      { kind: 'GUEST', partySize: 5 },
    ])
    expect(groupDoorList(rows)[0].people).toBe(7)
  })

  it('is empty for no rows', () => {
    expect(groupDoorList([])).toEqual([])
  })
})

describe('validPartySize', () => {
  it('accepts a positive whole number', () => {
    expect(validPartySize(1)).toBe(true)
    expect(validPartySize(12)).toBe(true)
  })

  it('refuses zero, negatives and fractions', () => {
    expect(validPartySize(0)).toBe(false)
    expect(validPartySize(-2)).toBe(false)
    expect(validPartySize(1.5)).toBe(false)
  })
})

describe('validateDoorListEntry', () => {
  it('refuses a blank name', () => {
    expect(validateDoorListEntry({ name: '  ', partySize: 1, kind: 'GUEST' })).toEqual({
      ok: false,
      error: expect.stringMatching(/name/i),
    })
  })

  it('refuses a party size under 1', () => {
    expect(validateDoorListEntry({ name: 'Ari Tāne', partySize: 0, kind: 'GUEST' })).toEqual({
      ok: false,
      error: expect.stringMatching(/party size/i),
    })
  })

  it('refuses an unknown kind', () => {
    expect(validateDoorListEntry({ name: 'Ari Tāne', partySize: 1, kind: 'VIP' })).toEqual({
      ok: false,
      error: expect.stringMatching(/kind/i),
    })
  })

  it('accepts a real name, a whole party size and a known kind', () => {
    expect(validateDoorListEntry({ name: 'Ari Tāne', partySize: 2, kind: 'COMP' })).toEqual({
      ok: true,
    })
  })
})

describe('the comps line follows the door list, through the real financeVals', () => {
  const base: FinanceEvent = {
    dow: 5,
    std: 30,
    door: 40,
    mix: [0.15, 0.5, 0.2, 0.15],
    att: [100, 150, 200],
    scen: 1,
    barHead: 20,
    gear: 0,
    adv: 0,
    crew: 6,
    tok: 2,
    split: 0.5,
    artists: [],
    shifts: [],
    tasks: [],
    addons: [],
    orgShareHours: 0,
  }

  it('costs the typed crew figure when the door list has no comps', () => {
    const vals = financeVals({ ...base, crew: compsCountFor([], base.crew) })
    expect(vals.comps).toBe(6 * 2 * CFG.tokenPrice * CFG.stockCost)
  })

  it('costs the door list total once it has comps on it, not the typed figure', () => {
    const doorList = [
      { kind: 'COMP' as const, partySize: 2 },
      { kind: 'COMP' as const, partySize: 3 },
    ]
    const vals = financeVals({ ...base, crew: compsCountFor(doorList, base.crew) })
    // 5 people from the list, not the 6 typed on the event record.
    expect(vals.comps).toBe(5 * 2 * CFG.tokenPrice * CFG.stockCost)
    expect(vals.comps).not.toBe(6 * 2 * CFG.tokenPrice * CFG.stockCost)
  })
})
