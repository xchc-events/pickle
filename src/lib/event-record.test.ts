import { describe, expect, it } from 'vitest'
import {
  advanceLabel,
  canAdvance,
  gatesDoneLabel,
  gatesFor,
  gatesMessage,
  isLate,
  timeMinutes,
  type GateArtist,
  type GateEvent,
} from './event-record'

/**
 * A fully-passing event at a given stage. Each test spoils exactly one thing,
 * so a failure names the gate it broke rather than the whole set.
 */
const act = (over: Partial<GateArtist> = {}): GateArtist => ({
  status: 'confirmed',
  hasPromo: true,
  hasBio: true,
  hasTechRider: true,
  ...over,
})

const ev = (over: Partial<GateEvent> = {}): GateEvent => ({
  stage: 0,
  hasOwner: true,
  dateTbc: false,
  hasSpace: true,
  kind: 'djs',
  promoter: 'Kōura Collective',
  internal: false,
  hasPortal: false,
  split: 0.6,
  dealState: 'agreed',
  dealNote: null,
  barClose: '11:00pm',
  doors: '8:00pm',
  allOut: '12:00am',
  licence: 'not_required',
  std: 30,
  ticketsLive: true,
  techStatus: 'confirmed',
  leads: { ticketing: true, design: true, promo: true, tech: true },
  artists: [act()],
  assets: [
    { key: 'vertical-1', tier: 'hero', state: 'approved', promoterSigned: true },
    { key: 'cover', tier: 'lead', state: 'approved', promoterSigned: true },
    { key: 'listing', tier: 'support', state: 'approved', promoterSigned: false },
  ],
  channels: [{ live: true, stale: false }],
  beatsDone: 2,
  shifts: [{ assigned: true, pencilled: false }],
  hoursLogged: 3,
  tasksWithActual: 1,
  hasActual: true,
  floor: 500,
  ceil: 1200,
  ...over,
})

/** The gate with this label, or a failure that names what was actually there. */
const gate = (e: GateEvent, label: string) => {
  const found = gatesFor(e).find((g) => g.label === label)
  if (!found) {
    throw new Error(
      `no gate "${label}" at stage ${e.stage} — have: ${gatesFor(e)
        .map((g) => g.label)
        .join(', ')}`,
    )
  }
  return found
}

describe('run times', () => {
  it('carries hours after midnight past 1440 rather than wrapping', () => {
    // The load-bearing case: 1am is *after* 11pm, not twelve hours before it.
    expect(timeMinutes('11:00pm')).toBe(1380)
    expect(timeMinutes('1:00am')).toBe(1500)
    expect(timeMinutes('1:00am')).toBeGreaterThan(timeMinutes('11:00pm'))
  })

  it('treats midnight itself as late', () => {
    expect(timeMinutes('12:00am')).toBe(1440)
    expect(isLate('12:00am')).toBe(true)
    expect(isLate('11:30pm')).toBe(false)
  })

  it('reads 6am and later as the same evening, not the next one', () => {
    // The prototype's cutoff. A 6am time is a morning event, not a 30-hour night.
    expect(timeMinutes('6:00am')).toBe(360)
    expect(timeMinutes('5:30am')).toBe(1770)
  })

  it('reads an unset time as zero rather than throwing', () => {
    expect(timeMinutes(null)).toBe(0)
    expect(timeMinutes('whenever')).toBe(0)
    expect(isLate(null)).toBe(false)
  })
})

describe('stage 0 — enquiry', () => {
  it('is clear when the four enquiry facts are settled', () => {
    expect(canAdvance(gatesFor(ev()))).toBe(true)
  })

  it('holds an event whose date is still TBC', () => {
    const g = gate(ev({ dateTbc: true }), 'Date is locked')
    expect(g.ok).toBe(false)
    expect(g.why).toBe('The enquiry still says date TBC')
  })

  it('holds an event with no owner', () => {
    expect(gate(ev({ hasOwner: false }), 'An owner is named').ok).toBe(false)
  })
})

describe('stage 1 — negotiating', () => {
  const neg = (over: Partial<GateEvent> = {}) => ev({ stage: 1, ...over })

  it('holds until an act is actually confirmed', () => {
    expect(canAdvance(gatesFor(neg()))).toBe(true)
    const pencilled = neg({ artists: [act({ status: 'pencilled' })] })
    expect(gate(pencilled, 'At least one act confirmed').ok).toBe(false)
  })

  it('does not count a declined act as the confirmed one', () => {
    const e = neg({ artists: [act({ status: 'declined' }), act({ status: 'enquired' })] })
    expect(gate(e, 'At least one act confirmed').ok).toBe(false)
  })

  it('quotes the promoter back when they queried the terms', () => {
    const e = neg({ dealState: 'queried', dealNote: 'the split is not what we said' })
    const g = gate(e, 'Terms agreed with the promoter')
    expect(g.ok).toBe(false)
    expect(g.why).toBe('They queried it: the split is not what we said')
  })

  it('points at the portal only when the promoter has one', () => {
    expect(
      gate(neg({ dealState: 'sent', hasPortal: true }), 'Terms agreed with the promoter').why,
    ).toBe('Waiting on them in their portal')
    expect(
      gate(neg({ dealState: 'sent', hasPortal: false }), 'Terms agreed with the promoter').why,
    ).toBe('Record the agreement below once they say yes')
  })

  it('holds a fee range that is inverted or unset', () => {
    expect(gate(neg({ floor: 0 }), 'Fee floor and ceiling agreed').ok).toBe(false)
    expect(gate(neg({ floor: 900, ceil: 500 }), 'Fee floor and ceiling agreed').ok).toBe(false)
  })

  it('holds an unassigned booking contact', () => {
    expect(gate(neg({ promoter: 'unassigned' }), 'Booking contact named').ok).toBe(false)
    expect(gate(neg({ promoter: null }), 'Booking contact named').ok).toBe(false)
  })
})

describe('stage 2 — confirmed, and the licence rule', () => {
  const conf = (over: Partial<GateEvent> = {}) => ev({ stage: 2, ...over })

  it('needs no licence when the bar closes before midnight', () => {
    const e = conf({ barClose: '11:00pm', licence: 'not_required' })
    expect(gate(e, 'Licence filed if it is needed').ok).toBe(true)
  })

  it('holds a bar running past midnight with no licence recorded', () => {
    // The gate that stops the venue trading unlawfully. Worth its own case.
    const e = conf({ barClose: '1:00am', licence: 'not_required' })
    const g = gate(e, 'Licence filed if it is needed')
    expect(g.ok).toBe(false)
    expect(g.why).toBe('Bar runs past midnight with no licence recorded')
  })

  it('accepts a late bar once the licence is at least applied for', () => {
    expect(
      gate(conf({ barClose: '1:00am', licence: 'applied_for' }), 'Licence filed if it is needed')
        .ok,
    ).toBe(true)
  })

  it('stops outright on a denied licence, however early the bar closes', () => {
    expect(
      gate(conf({ barClose: '9:00pm', licence: 'denied' }), 'Special licence not denied').ok,
    ).toBe(false)
  })

  it('holds when an act is missing a bio or a press shot', () => {
    expect(gate(conf({ artists: [act({ hasBio: false })] }), 'Artist bios and pics in').ok).toBe(
      false,
    )
    expect(gate(conf({ artists: [act({ hasPromo: false })] }), 'Artist bios and pics in').ok).toBe(
      false,
    )
  })

  it('ignores a declined act that never sent a bio', () => {
    const e = conf({
      artists: [act(), act({ status: 'declined', hasBio: false, hasPromo: false })],
    })
    expect(gate(e, 'Artist bios and pics in').ok).toBe(true)
  })

  it('adds the portal chase only when there is a portal to chase in', () => {
    const withPortal = conf({ artists: [act({ hasBio: false })], hasPortal: true })
    expect(gate(withPortal, 'Artist bios and pics in').why).toContain('chase it in their portal')
    const without = conf({ artists: [act({ hasBio: false })], hasPortal: false })
    expect(gate(without, 'Artist bios and pics in').why).not.toContain('portal')
  })
})

describe('stage 3 — design sign-off', () => {
  const des = (over: Partial<GateEvent> = {}) => ev({ stage: 3, ...over })

  it('needs every hero cut approved, not just one', () => {
    const e = des({
      assets: [
        { key: 'vertical-1', tier: 'hero', state: 'approved', promoterSigned: true },
        { key: 'vertical-2', tier: 'hero', state: 'review', promoterSigned: true },
        { key: 'cover', tier: 'lead', state: 'approved', promoterSigned: true },
        { key: 'listing', tier: 'support', state: 'approved', promoterSigned: false },
      ],
    })
    expect(gate(e, 'Both vertical cuts signed off').ok).toBe(false)
  })

  it('counts the promoter sign-off only when they have a portal', () => {
    const unsigned = [
      {
        key: 'vertical-1',
        tier: 'hero' as const,
        state: 'approved' as const,
        promoterSigned: false,
      },
      { key: 'cover', tier: 'lead' as const, state: 'approved' as const, promoterSigned: false },
      {
        key: 'listing',
        tier: 'support' as const,
        state: 'approved' as const,
        promoterSigned: false,
      },
    ]
    expect(
      gate(des({ assets: unsigned, hasPortal: false }), 'Promoter signed off the creative').ok,
    ).toBe(true)

    const g = gate(des({ assets: unsigned, hasPortal: true }), 'Promoter signed off the creative')
    expect(g.ok).toBe(false)
    expect(g.why).toBe('2 pieces not signed off in their portal')
  })

  it('says "piece" for one and "pieces" for more', () => {
    const one = [
      {
        key: 'vertical-1',
        tier: 'hero' as const,
        state: 'approved' as const,
        promoterSigned: false,
      },
      { key: 'cover', tier: 'lead' as const, state: 'approved' as const, promoterSigned: true },
    ]
    expect(
      gate(des({ assets: one, hasPortal: true }), 'Promoter signed off the creative').why,
    ).toBe('1 piece not signed off in their portal')
  })
})

describe('stage 4 — on sale', () => {
  const sale = (over: Partial<GateEvent> = {}) => ev({ stage: 4, ...over })

  it('holds a listing that went stale after a change', () => {
    const e = sale({ channels: [{ live: true, stale: true }] })
    expect(gate(e, 'Nothing stale on a listing').ok).toBe(false)
  })

  it('counts channels not yet out, singular and plural', () => {
    expect(
      gate(
        sale({ channels: [{ live: false, stale: false }] }),
        'Every channel listed or ticked off',
      ).why,
    ).toBe('1 channel not out yet')
    expect(
      gate(
        sale({
          channels: [
            { live: false, stale: false },
            { live: false, stale: false },
          ],
        }),
        'Every channel listed or ticked off',
      ).why,
    ).toBe('2 channels not out yet')
  })

  it('needs the announce and on-sale beats both worked', () => {
    expect(gate(sale({ beatsDone: 1 }), 'Announce and on-sale beats done').ok).toBe(false)
    expect(gate(sale({ beatsDone: 2 }), 'Announce and on-sale beats done').ok).toBe(true)
  })
})

describe('stage 5 — rostering', () => {
  const ros = (over: Partial<GateEvent> = {}) => ev({ stage: 5, ...over })

  it('counts open shifts, singular and plural', () => {
    expect(
      gate(ros({ shifts: [{ assigned: false, pencilled: false }] }), 'Every shift filled').why,
    ).toBe('1 shift still open')
  })

  it('treats a pencilled shift as filled but not settled', () => {
    const e = ros({ shifts: [{ assigned: true, pencilled: true }] })
    expect(gate(e, 'Every shift filled').ok).toBe(true)
    expect(gate(e, 'Nothing left pencilled').ok).toBe(false)
  })

  it('names the state a tech plan is still in', () => {
    expect(gate(ros({ techStatus: 'draft' }), 'Tech plan confirmed').why).toBe(
      'Plan is still draft',
    )
  })

  it('counts acts without a tech rider', () => {
    expect(gate(ros({ artists: [act({ hasTechRider: false })] }), 'Tech riders in').why).toBe(
      '1 act without a rider',
    )
  })
})

describe('stage 6 — show week', () => {
  const week = (over: Partial<GateEvent> = {}) => ev({ stage: 6, ...over })

  it('needs the licence confirmed, not merely applied for, once past midnight', () => {
    expect(
      gate(week({ barClose: '1:00am', licence: 'applied_for' }), 'Licence confirmed if needed').ok,
    ).toBe(false)
    expect(
      gate(week({ barClose: '1:00am', licence: 'confirmed' }), 'Licence confirmed if needed').ok,
    ).toBe(true)
  })

  it('reads the licence state as words inside the sentence', () => {
    const g = gate(
      week({ barClose: '2:00am', licence: 'applied_for' }),
      'Licence confirmed if needed',
    )
    expect(g.why).toBe('Bar past midnight and the licence is applied for')
  })

  it('needs both run times, not one', () => {
    expect(gate(week({ doors: null }), 'Run times set').ok).toBe(false)
    expect(gate(week({ allOut: null }), 'Run times set').ok).toBe(false)
    expect(gate(week(), 'Run times set').ok).toBe(true)
  })
})

describe('stage 7 — payout', () => {
  const pay = (over: Partial<GateEvent> = {}) => ev({ stage: 7, ...over })

  it('accepts either a timesheet row or a task actual as time logged', () => {
    expect(
      gate(pay({ hoursLogged: 0, tasksWithActual: 1 }), 'Hours logged for this event').ok,
    ).toBe(true)
    expect(
      gate(pay({ hoursLogged: 2, tasksWithActual: 0 }), 'Hours logged for this event').ok,
    ).toBe(true)
    expect(
      gate(pay({ hoursLogged: 0, tasksWithActual: 0 }), 'Hours logged for this event').ok,
    ).toBe(false)
  })

  it('holds until the bar take and ticket count are reconciled', () => {
    expect(gate(pay({ hasActual: false }), 'Actuals in').ok).toBe(false)
  })
})

describe('the gate summary', () => {
  it('has a set for every stage and nothing past the last', () => {
    for (let stage = 0; stage <= 7; stage++) {
      expect(gatesFor(ev({ stage })).length).toBeGreaterThan(0)
    }
    expect(gatesFor(ev({ stage: 8 }))).toEqual([])
  })

  it('counts what is clear', () => {
    expect(gatesDoneLabel(gatesFor(ev()))).toBe('4 of 4 clear')
    expect(gatesDoneLabel(gatesFor(ev({ hasOwner: false })))).toBe('3 of 4 clear')
  })

  it('names the blocker rather than only counting it', () => {
    expect(gatesMessage(gatesFor(ev({ hasOwner: false })), 0)).toBe(
      'One thing holds this up: an owner is named.',
    )
    const two = gatesFor(ev({ hasOwner: false, dateTbc: true }))
    expect(gatesMessage(two, 0)).toBe('2 things hold this up, starting with an owner is named.')
  })

  it('says where a clear event can go next', () => {
    expect(gatesMessage(gatesFor(ev()), 0)).toBe(
      'Everything is clear — this can move to Negotiating.',
    )
    expect(gatesMessage(gatesFor(ev({ stage: 7 })), 7)).toBe(
      'Everything is clear — this event can be put to bed.',
    )
  })

  it('completes rather than advancing off the end', () => {
    expect(advanceLabel(0)).toBe('Move to Negotiating')
    expect(advanceLabel(6)).toBe('Move to Payout')
    expect(advanceLabel(7)).toBe('Complete')
  })
})
