import { describe, expect, it } from 'vitest'
import {
  ROLE_WIN,
  ROLE_WIN_EARLY,
  callFor,
  dayPeriod,
  fitFor,
  rolesFor,
  shiftPlan,
  shortfall,
  windowFor,
} from './roster'

/**
 * The rostering rules.
 *
 * Ported from `genShifts` and `AVAIL_SEED` in the design prototype
 * (docs/design-handoff/design/Pickle Prototype.dc.html, near lines 2906 and
 * 3266). Like `finance.ts` this is specification rather than implementation —
 * every number here is what the venue actually staffs, and changing one
 * changes who is asked to work.
 *
 * These are tested before the module is built because the output is hours,
 * and hours are wages: a role added by accident is money the event loses.
 */

const music = {
  spaceName: 'Main',
  format: 'DJs',
  kind: 'djs',
  att: [80, 120, 180] as [number, number, number],
  lateBar: true,
}

describe('the role list', () => {
  it('staffs a standard music night with the full crew', () => {
    const roles = rolesFor(music)
    expect(roles).toContain('Duty manager')
    expect(roles).toContain('Sound — Lead')
    expect(roles.filter((r) => r === 'Door')).toHaveLength(2)
    expect(roles.filter((r) => r === 'Care team')).toHaveLength(2)
    expect(roles.filter((r) => r === 'Set-up crew')).toHaveLength(2)
    expect(roles.filter((r) => r === 'Clean-up crew')).toHaveLength(2)
  })

  it('puts a second bar staff on when the likely crowd is over 140', () => {
    const quiet = rolesFor({ ...music, att: [40, 90, 130] })
    const busy = rolesFor({ ...music, att: [80, 160, 200] })
    expect(quiet.filter((r) => r === 'Bar staff')).toHaveLength(1)
    expect(busy.filter((r) => r === 'Bar staff')).toHaveLength(2)
  })

  it('reads the likely scenario, not the optimistic one', () => {
    // [quiet, likely, great] — a great night of 200 does not staff the bar.
    expect(
      rolesFor({ ...music, att: [40, 100, 200] }).filter((r) => r === 'Bar staff'),
    ).toHaveLength(1)
  })

  it('falls back to 62% of capacity when attendance has not been modelled', () => {
    // 220 * 0.62 = 136, which is under 140 — so one bar staff.
    expect(rolesFor({ ...music, att: [0, 0, 0] }).filter((r) => r === 'Bar staff')).toHaveLength(1)
    // Cabaret caps at 150, so 93 — still one.
    expect(
      rolesFor({ ...music, format: 'Cabaret', att: [0, 0, 0] }).filter((r) => r === 'Bar staff'),
    ).toHaveLength(1)
  })

  it('adds a second sound op only for live music', () => {
    expect(rolesFor({ ...music, kind: 'live' })).toContain('Sound — 2IC')
    expect(rolesFor({ ...music, kind: 'live-djs' })).toContain('Sound — 2IC')
    expect(rolesFor({ ...music, kind: 'djs' })).not.toContain('Sound — 2IC')
  })

  it('runs a workshop with one door and one care team, not two', () => {
    const roles = rolesFor({ ...music, kind: 'workshop' })
    expect(roles.filter((r) => r === 'Door')).toHaveLength(1)
    expect(roles.filter((r) => r === 'Care team')).toHaveLength(1)
  })

  /**
   * The upstairs room seats forty and runs early. One of each — doubling up
   * in a room that size costs wages and gets in the way.
   */
  it('staffs the apartment with one of each and no doubling up', () => {
    const roles = rolesFor({ ...music, spaceName: 'Apartment U1' })
    expect(roles).toHaveLength(7)
    expect(new Set(roles).size).toBe(7)
    expect(roles).not.toContain('Sound — 2IC')
  })

  it('ignores the crowd size in the apartment — the room is the limit', () => {
    expect(rolesFor({ ...music, spaceName: 'Apartment U1', att: [0, 300, 0] })).toHaveLength(7)
  })
})

describe('shift windows', () => {
  it('uses the late-bar windows by default', () => {
    expect(windowFor('Duty manager', true)).toEqual(ROLE_WIN['Duty manager'])
  })

  it('uses the shorter windows for an early event', () => {
    expect(windowFor('Duty manager', false)).toEqual(ROLE_WIN_EARLY['Duty manager'])
    expect(windowFor('Duty manager', false)![1]).toBeLessThan(ROLE_WIN['Duty manager']![1])
  })

  it('falls back rather than returning nothing for an unknown role', () => {
    expect(windowFor('Pyrotechnician', true)).toEqual([3, 4])
  })

  it('starts the sound lead at doors-minus-nothing — they are in first', () => {
    expect(ROLE_WIN['Sound — Lead']![0]).toBe(0)
    expect(ROLE_WIN['Set-up crew']![0]).toBe(0)
  })
})

describe('the plan', () => {
  it('gives every role its hours and start offset', () => {
    const plan = shiftPlan(music)
    const dm = plan.find((s) => s.role === 'Duty manager')!
    expect(dm.hours).toBe(6)
    expect(dm.start).toBe(3)
  })

  /** A workshop's sound op is there for the session, not a full show call. */
  it('shortens the workshop sound call', () => {
    expect(
      shiftPlan({ ...music, kind: 'workshop' }).find((s) => s.role === 'Sound — Lead')!.hours,
    ).toBe(4)
    expect(
      shiftPlan({ ...music, kind: 'workshop', spaceName: 'Apartment U1' }).find(
        (s) => s.role === 'Sound — Lead',
      )!.hours,
    ).toBe(3)
  })

  it('does not shorten the sound call on a normal show', () => {
    expect(shiftPlan(music).find((s) => s.role === 'Sound — Lead')!.hours).toBe(8)
  })

  it('totals to the call the event actually pays for', () => {
    // The figure that reaches the P&L. If this moves, wages moved.
    expect(callFor(music)).toBeCloseTo(
      shiftPlan(music).reduce((n, s) => n + s.hours, 0),
      5,
    )
  })
})

describe('day periods', () => {
  it('keys the way availability is stored', () => {
    // Friday the 4th of September 2026 is a Friday.
    expect(dayPeriod(new Date('2026-09-04T20:00:00'))).toBe('Fri-eve')
    expect(dayPeriod(new Date('2026-09-04T11:00:00'))).toBe('Fri-day')
  })

  it('treats 5pm onwards as the evening', () => {
    expect(dayPeriod(new Date('2026-09-05T16:59:00'))).toBe('Sat-day')
    expect(dayPeriod(new Date('2026-09-05T17:00:00'))).toBe('Sat-eve')
  })
})

describe('who fits a shift', () => {
  const avail = { weekly: 10, volunteer: 0, yes: ['Fri-eve'], no: ['Mon-eve'] }

  it('is keen when the slot is one they said yes to', () => {
    expect(fitFor(avail, 'Fri-eve', 0, 5).tone).toBe('good')
  })

  it('is a no when the slot is one they said no to', () => {
    expect(fitFor(avail, 'Mon-eve', 0, 5).tone).toBe('stop')
  })

  it('is neutral for a slot they have no view on', () => {
    expect(fitFor(avail, 'Wed-eve', 0, 5).tone).toBe('plain')
  })

  it('warns when the shift would take them past their weekly cap', () => {
    const v = fitFor(avail, 'Fri-eve', 8, 5)
    expect(v.tone).toBe('warn')
    expect(v.why).toMatch(/cap|hour|week/i)
  })

  it('treats the cap as harder than a stated preference', () => {
    // They said yes to Friday, but they are already at their hours.
    expect(fitFor(avail, 'Fri-eve', 10, 2).tone).toBe('warn')
  })

  it('still refuses a slot they said no to, even under their cap', () => {
    expect(fitFor(avail, 'Mon-eve', 0, 1).tone).toBe('stop')
  })

  it('counts volunteer hours as extra headroom, not as booked time', () => {
    const v = fitFor({ ...avail, volunteer: 6 }, 'Fri-eve', 12, 2)
    expect(v.tone).not.toBe('warn')
  })
})

describe('shortfall', () => {
  it('is silent when every shift is covered', () => {
    expect(shortfall([{ state: 'ASSIGNED' }, { state: 'DONE' }])).toBeNull()
  })

  it('counts what is open', () => {
    expect(shortfall([{ state: 'OPEN' }, { state: 'OPEN' }, { state: 'ASSIGNED' }])).toMatch(
      /2 shifts/,
    )
  })

  it('counts an asked-but-unanswered shift as still open', () => {
    expect(shortfall([{ state: 'ASKED' }])).toMatch(/1 shift/)
  })

  it('reads as one shift, not 1 shifts', () => {
    expect(shortfall([{ state: 'OPEN' }])).toMatch(/1 shift[^s]/)
  })
})
