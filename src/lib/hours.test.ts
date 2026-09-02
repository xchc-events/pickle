import { describe, expect, it } from 'vitest'
import {
  ORG_ROLES,
  TEAMS,
  apportion,
  costOf,
  effectOf,
  isOrgRole,
  monthKey,
  monthLabel,
  splitOf,
} from './hours'
import { CFG } from './finance'

/**
 * Hours.
 *
 * Written before the implementation because every figure here is wages. The
 * central one is `effectOf`: the prototype puts a sentence under the entry
 * form saying exactly where the money lands, and the handoff calls this "the
 * module that makes the profit share arguable". A person logging four hours
 * should be able to see, before they press anything, whose surplus it comes
 * out of.
 */

describe('the roles', () => {
  /**
   * "Bar admin & accounting" appears on both lists, and that is the
   * prototype's own doing rather than a slip: reconciling one event's bar is
   * event work, and keeping the bar's books is org-wide. The same person does
   * both under the same name.
   *
   * The consequence is the important part — **a role name cannot tell you
   * which kind of hour it is.** That comes from whether the entry hangs off an
   * event, which is why `splitOf` reads `eventId` and never the role.
   */
  it('shares exactly one name between the two lists', () => {
    const shared = TEAMS.filter((t) => (ORG_ROLES as readonly string[]).includes(t))
    expect(shared).toEqual(['Bar admin & accounting'])
  })

  it('recognises a name from either list', () => {
    expect(isOrgRole('Grant writing & reporting')).toBe(true)
    expect(isOrgRole('Event coordination')).toBe(false)
    expect(isOrgRole('Something nobody defined')).toBe(false)
  })

  it('reports the shared name as belonging to both', () => {
    // Not a contradiction — see above. The caller decides from the event.
    expect(isOrgRole('Bar admin & accounting')).toBe(true)
    expect(TEAMS).toContain('Bar admin & accounting')
  })
})

describe('costOf', () => {
  it('uses the loaded rate, never the base one', () => {
    expect(costOf(1)).toBe(CFG.loaded)
    expect(costOf(1)).not.toBe(CFG.rate)
  })

  it('is zero for no hours', () => {
    expect(costOf(0)).toBe(0)
  })

  it('scales', () => {
    expect(costOf(10)).toBeCloseTo(336.6, 5)
  })
})

describe('months', () => {
  it('keys sortably, so a list orders itself', () => {
    expect(monthKey(new Date('2026-08-15T10:00:00'))).toBe('2026-08')
    expect(monthKey(new Date('2026-12-01T10:00:00'))).toBe('2026-12')
  })

  it('sorts across a year boundary', () => {
    const keys = [new Date('2027-01-04'), new Date('2026-12-04')].map(monthKey).sort()
    expect(keys).toEqual(['2026-12', '2027-01'])
  })

  it('labels the way the venue says it', () => {
    expect(monthLabel('2026-08')).toBe('Aug 2026')
  })

  it('does not fall over on a key it does not recognise', () => {
    expect(monthLabel('nonsense')).toBe('nonsense')
  })
})

describe('apportion', () => {
  /**
   * Org-wide labour is pooled by month and spread across the events in that
   * month. It is the line that makes a quiet month expensive per event, which
   * is exactly the argument the module exists to enable.
   */
  it('spreads a month of org hours across its events', () => {
    expect(apportion(30, 3)).toBe(10)
  })

  it('lands the whole pool on one event when only one ran', () => {
    expect(apportion(30, 1)).toBe(30)
  })

  it('is zero when nothing was logged', () => {
    expect(apportion(0, 4)).toBe(0)
  })

  /**
   * A month with org hours and no events is real — a quiet January still has
   * administration in it. Those hours do not vanish, but there is nothing to
   * put them on, so the answer is zero per event rather than a division by
   * zero or the whole pool landing on nothing.
   */
  it('does not divide by zero when no events ran that month', () => {
    expect(apportion(30, 0)).toBe(0)
  })

  it('rounds to a tenth, because that is what is shown', () => {
    expect(apportion(10, 3)).toBe(3.3)
  })
})

describe('splitOf', () => {
  const rows = [
    { hours: 5, shiftId: 's1', eventId: 'e1' },
    { hours: 3, shiftId: null, eventId: 'e1' },
    { hours: 2, shiftId: null, eventId: null },
  ]

  it('tells the three kinds apart by what they hang off', () => {
    const s = splitOf(rows)
    expect(s.onSite).toBe(5)
    expect(s.offSite).toBe(3)
    expect(s.org).toBe(2)
  })

  it('totals everything', () => {
    expect(splitOf(rows).total).toBe(10)
  })

  it('is all zeroes for nothing', () => {
    expect(splitOf([])).toEqual({ onSite: 0, offSite: 0, org: 0, total: 0 })
  })

  it('counts a shift-backed row as on-site even without an event', () => {
    expect(splitOf([{ hours: 4, shiftId: 's1', eventId: null }]).onSite).toBe(4)
  })
})

describe('effectOf — where the money lands', () => {
  it('says nothing useful until there are hours, and says so', () => {
    const e = effectOf({ hours: 0, kind: 'event', role: 'Design & comms', target: 'Static Bloom' })
    expect(e.tone).toBe('plain')
    expect(e.text).toMatch(/enter your hours/i)
  })

  it('names the event and the line the money comes off', () => {
    const e = effectOf({
      hours: 4,
      kind: 'event',
      role: 'Design & comms',
      target: 'Static Bloom',
    })
    expect(e.text).toContain('Static Bloom')
    expect(e.text).toContain('design & comms')
    // 4h at the loaded rate is $134.64, shown rounded.
    expect(e.text).toMatch(/\$135/)
    expect(e.text).toMatch(/surplus/i)
  })

  it('spreads an org-wide entry across the events in the month, and shows the each', () => {
    const e = effectOf({
      hours: 6,
      kind: 'org',
      role: 'Grant writing & reporting',
      target: 'Aug 2026',
      eventsInMonth: 3,
    })
    expect(e.text).toContain('3 events')
    expect(e.text).toContain('Aug 2026')
    // $202 total, $67 each.
    expect(e.text).toMatch(/\$67/)
  })

  it('says one event without pluralising', () => {
    const e = effectOf({
      hours: 6,
      kind: 'org',
      role: 'Venue administration',
      target: 'Aug 2026',
      eventsInMonth: 1,
    })
    expect(e.text).toContain('1 event ')
    expect(e.text).not.toContain('1 events')
  })

  /**
   * The honest answer when there is nothing to spread across. Silently
   * dropping the hours, or showing "$0 each", would both hide that the work
   * happened and is not being charged anywhere.
   */
  it('says plainly when a month has no events to carry the hours', () => {
    const e = effectOf({
      hours: 6,
      kind: 'org',
      role: 'Venue administration',
      target: 'Jan 2027',
      eventsInMonth: 0,
    })
    expect(e.tone).toBe('warn')
    expect(e.text).toMatch(/no events|nothing to/i)
  })
})
