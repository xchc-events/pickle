import { describe, expect, it } from 'vitest'
import { BUILT_MODULES } from './constants'
import { ASSET_SET, type AssetState, type EventAsset } from './design'
import {
  BOOKING,
  PARTS,
  canGoOnSale,
  isPastBookingTarget,
  nextBooking,
  nextMove,
  partsFor,
  type GateArtist,
  type PartKey,
  type PartsEvent,
} from './parts'

/**
 * A confirmed event with every part finished. Each test spoils exactly one
 * thing, so a failure names the part and the gate it broke rather than the
 * whole event.
 */
const act = (over: Partial<GateArtist> = {}): GateArtist => ({
  status: 'confirmed',
  hasPromo: true,
  hasBio: true,
  hasTechRider: true,
  ...over,
})

/** The whole house set in one state. */
const everyPiece = (state: AssetState = 'approved', promoterSigned = true): EventAsset[] =>
  ASSET_SET.map((a) => ({ key: a.key, state, promoterSigned }))

/** The house set with the first `n` pieces approved and the rest in `rest`. */
const approvedFirst = (n: number, rest: AssetState = 'draft'): EventAsset[] =>
  ASSET_SET.map((a, i) => ({ key: a.key, state: i < n ? 'approved' : rest, promoterSigned: true }))

const ev = (over: Partial<PartsEvent> = {}): PartsEvent => ({
  booking: 'confirmed',
  bookingDays: 2,
  concluded: false,
  daysToDoor: 20,
  hasOwner: true,
  dateTbc: false,
  hasSpace: true,
  kind: 'djs',
  promoter: 'Kōura Collective',
  hasPortal: false,
  split: 0.6,
  dealState: 'agreed',
  dealNote: null,
  floor: 500,
  ceil: 1200,
  artists: [act()],
  barClose: '11:00pm',
  doors: '8:00pm',
  allOut: '12:00am',
  licence: 'not_required',
  techStatus: 'confirmed',
  leads: { ticketing: true, design: true, promo: true, tech: true },
  assets: everyPiece(),
  artworkFiles: 0,
  channels: [{ live: true, stale: false }],
  beatsDone: 2,
  std: 30,
  ticketsLive: true,
  sold: 40,
  capacity: 220,
  shifts: [{ assigned: true, pencilled: false }],
  hoursLogged: 3,
  tasksWithActual: 1,
  doorCounted: true,
  barClosed: true,
  ...over,
})

const part = (e: PartsEvent, key: PartKey) => {
  const found = partsFor(e).find((p) => p.key === key)
  if (!found) throw new Error(`no part "${key}"`)
  return found
}

/** The gate with this label on this part, or a failure naming what was there. */
const gate = (e: PartsEvent, key: PartKey, label: string) => {
  const p = part(e, key)
  const found = p.checks.find((g) => g.label === label)
  if (!found) {
    throw new Error(
      `no gate "${label}" on ${key} — have: ${p.checks.map((g) => g.label).join(', ')}`,
    )
  }
  return found
}

describe('the parts of an event', () => {
  it('are eight, in the order the pipeline reads them', () => {
    expect(PARTS.map((p) => p.label)).toEqual([
      'Booking',
      'Design',
      'Promo',
      'Tickets',
      'Licence',
      'Tech',
      'Roster',
      'Settlement',
    ])
  })

  it('gives every event a status for every part, in that order', () => {
    expect(partsFor(ev()).map((p) => p.key)).toEqual(PARTS.map((p) => p.key))
  })

  it('reads a finished event as finished on every part but settlement', () => {
    const open = partsFor(ev())
      .filter((p) => !p.done)
      .map((p) => p.key)
    // Settlement is only done once somebody puts the event to bed.
    expect(open).toEqual(['settlement'])
  })
})

/**
 * Why this file exists. Work on a show does not happen in a line: a promoter
 * sends their tour artwork with the enquiry, and tickets go up while the
 * poster is still being argued over. Each part carries its own status, so one
 * running ahead of another is a normal state rather than an impossible one.
 */
describe('parts that run out of order', () => {
  it('puts tickets on sale while the design is still being signed off', () => {
    const e = ev({ assets: approvedFirst(2, 'review') })
    expect(part(e, 'tickets')).toMatchObject({ status: 'on sale', done: true })
    expect(part(e, 'design')).toMatchObject({ status: '2 of 6', done: false })
  })

  it('takes a promoter’s artwork in while the booking is still an enquiry', () => {
    const e = ev({
      booking: 'enquiry',
      assets: everyPiece('draft', false),
      artworkFiles: 4,
      ticketsLive: false,
    })
    expect(part(e, 'booking').status).toBe('enquiry')
    expect(part(e, 'design').status).toBe('assets in')
  })

  it('does not hold any part on the design being finished', () => {
    const e = ev({ assets: everyPiece('draft', false) })
    const waiting = partsFor(e).filter((p) => p.checks.some((g) => !g.ok))
    expect(waiting.map((p) => p.key)).toEqual(['design'])
  })
})

// ---------------------------------------------------------------- booking ---

describe('booking targets', () => {
  it('flags an enquiry that has sat past three days, and a negotiation past seven', () => {
    expect(isPastBookingTarget('enquiry', 3)).toBe(false)
    expect(isPastBookingTarget('enquiry', 4)).toBe(true)
    expect(isPastBookingTarget('negotiating', 7)).toBe(false)
    expect(isPastBookingTarget('negotiating', 8)).toBe(true)
  })

  it('never flags a confirmed booking, however long ago it was confirmed', () => {
    expect(isPastBookingTarget('confirmed', 400)).toBe(false)
  })

  it('keeps the booking nicknames the stages had', () => {
    expect(BOOKING.map((b) => b.nick)).toEqual(['Fresh', 'Brining', 'Sealed'])
  })

  it('moves one step at a time and stops at confirmed', () => {
    expect(nextBooking('enquiry')).toBe('negotiating')
    expect(nextBooking('negotiating')).toBe('confirmed')
    expect(nextBooking('confirmed')).toBeNull()
  })
})

describe('booking — its status', () => {
  it('counts the days an enquiry has sat', () => {
    expect(part(ev({ booking: 'enquiry', bookingDays: 2 }), 'booking')).toMatchObject({
      status: 'enquiry',
      detail: '2 days',
      tone: 'plain',
      done: false,
    })
  })

  it('warns once a booking has sat past its target', () => {
    expect(part(ev({ booking: 'enquiry', bookingDays: 4 }), 'booking').tone).toBe('warn')
    expect(part(ev({ booking: 'negotiating', bookingDays: 8 }), 'booking').tone).toBe('warn')
  })

  it('warns while the promoter has queried the terms', () => {
    const e = ev({ booking: 'negotiating', bookingDays: 1, dealState: 'queried', dealNote: 'no' })
    expect(part(e, 'booking').tone).toBe('warn')
  })

  it('is done once confirmed, with nothing left to clear', () => {
    expect(part(ev(), 'booking')).toMatchObject({
      status: 'confirmed',
      detail: null,
      tone: 'good',
      done: true,
      checks: [],
    })
  })
})

describe('booking — enquiry to negotiating', () => {
  const enq = (over: Partial<PartsEvent> = {}) => ev({ booking: 'enquiry', ...over })

  it('is clear when the four enquiry facts are settled', () => {
    expect(part(enq(), 'booking').checks).toHaveLength(4)
    expect(part(enq(), 'booking').clear).toBe(true)
  })

  it('holds an event whose date is still TBC', () => {
    const g = gate(enq({ dateTbc: true }), 'booking', 'Date is locked')
    expect(g.ok).toBe(false)
    expect(g.why).toBe('The enquiry still says date TBC')
  })

  it('holds an event with no owner', () => {
    expect(gate(enq({ hasOwner: false }), 'booking', 'An owner is named').ok).toBe(false)
  })

  it('holds an event with no room or kind of night', () => {
    expect(gate(enq({ hasSpace: false }), 'booking', 'Space chosen').ok).toBe(false)
    expect(gate(enq({ kind: null }), 'booking', 'Kind of night set').ok).toBe(false)
  })
})

describe('booking — negotiating to confirmed', () => {
  const neg = (over: Partial<PartsEvent> = {}) => ev({ booking: 'negotiating', ...over })

  it('holds until an act is actually confirmed', () => {
    expect(part(neg(), 'booking').clear).toBe(true)
    const pencilled = neg({ artists: [act({ status: 'pencilled' })] })
    expect(gate(pencilled, 'booking', 'At least one act confirmed').ok).toBe(false)
  })

  it('does not count a declined act as the confirmed one', () => {
    const e = neg({ artists: [act({ status: 'declined' }), act({ status: 'enquired' })] })
    expect(gate(e, 'booking', 'At least one act confirmed').ok).toBe(false)
  })

  it('quotes the promoter back when they queried the terms', () => {
    const e = neg({ dealState: 'queried', dealNote: 'the split is not what we said' })
    const g = gate(e, 'booking', 'Terms agreed with the promoter')
    expect(g.ok).toBe(false)
    expect(g.why).toBe('They queried it: the split is not what we said')
  })

  it('points at the portal only when the promoter has one', () => {
    expect(
      gate(neg({ dealState: 'sent', hasPortal: true }), 'booking', 'Terms agreed with the promoter')
        .why,
    ).toBe('Waiting on them in their portal')
    expect(
      gate(
        neg({ dealState: 'sent', hasPortal: false }),
        'booking',
        'Terms agreed with the promoter',
      ).why,
    ).toBe('Record the agreement below once they say yes')
  })

  it('holds a fee range that is inverted or unset', () => {
    expect(gate(neg({ floor: 0 }), 'booking', 'Fee floor and ceiling agreed').ok).toBe(false)
    expect(gate(neg({ floor: 900, ceil: 500 }), 'booking', 'Fee floor and ceiling agreed').ok).toBe(
      false,
    )
  })

  it('holds an unassigned booking contact', () => {
    expect(gate(neg({ promoter: 'unassigned' }), 'booking', 'Booking contact named').ok).toBe(false)
    expect(gate(neg({ promoter: null }), 'booking', 'Booking contact named').ok).toBe(false)
  })

  it('holds an unsplit deal and an undecided bar close', () => {
    expect(gate(neg({ split: 0 }), 'booking', 'Split agreed').ok).toBe(false)
    expect(gate(neg({ barClose: null }), 'booking', 'Bar close decided').ok).toBe(false)
  })
})

// ----------------------------------------------------------------- design ---

describe('design — its status', () => {
  it('has not started while every piece is a draft and nothing is uploaded', () => {
    expect(part(ev({ assets: everyPiece('draft') }), 'design')).toMatchObject({
      status: 'not started',
      tone: 'dim',
      done: false,
    })
  })

  it('reads a draft set with artwork uploaded as assets in', () => {
    expect(part(ev({ assets: everyPiece('draft'), artworkFiles: 2 }), 'design')).toMatchObject({
      status: 'assets in',
      tone: 'plain',
    })
  })

  it('counts pieces signed off, and says when one is in review', () => {
    expect(part(ev({ assets: approvedFirst(2, 'review') }), 'design')).toMatchObject({
      status: '2 of 6',
      detail: 'in review',
      tone: 'plain',
    })
    expect(part(ev({ assets: approvedFirst(2) }), 'design').detail).toBeNull()
  })

  it('treats a piece with no row as a draft, not as missing from the set', () => {
    // The set is what the house asks for, not what happens to exist.
    const e = ev({ assets: [{ key: 'cover', state: 'approved', promoterSigned: true }] })
    expect(part(e, 'design').status).toBe('1 of 6')
  })

  it('waits on the promoter once the venue has signed everything off', () => {
    const e = ev({ hasPortal: true, assets: everyPiece('approved', false) })
    expect(part(e, 'design')).toMatchObject({
      status: 'with promoter',
      detail: '3 to sign',
      tone: 'warn',
      done: false,
    })
  })

  it('is signed off when every piece is approved and every gate is clear', () => {
    expect(part(ev(), 'design')).toMatchObject({ status: 'signed off', tone: 'good', done: true })
  })

  it('says only the art is signed off while a gate still fails, and names what is open', () => {
    // "How can it be signed off and one to clear?" (Connor, 22 Sep 2026). The
    // pieces are done and the part is not, so the cell says which is which.
    const noLead = ev({ leads: { ticketing: true, design: false, promo: true, tech: true } })
    expect(part(noLead, 'design')).toMatchObject({
      status: 'art signed off',
      detail: 'no lead',
      tone: 'plain',
      done: false,
    })

    const noBios = ev({ artists: [act({ hasBio: false }), act({ hasPromo: false })] })
    expect(part(noBios, 'design')).toMatchObject({
      status: 'art signed off',
      detail: "2 acts' bios and pics to chase",
      done: false,
    })
    expect(part(ev({ artists: [act({ hasBio: false })] }), 'design').detail).toBe(
      "1 act's bios and pics to chase",
    )
  })

  it('counts what is open when more than one thing is', () => {
    const e = ev({
      leads: { ticketing: true, design: false, promo: true, tech: true },
      artists: [act({ hasBio: false })],
    })
    expect(part(e, 'design')).toMatchObject({ status: 'art signed off', detail: '2 to clear' })
  })
})

describe('design — its gates', () => {
  it('holds when nobody leads the creative', () => {
    const e = ev({ leads: { ticketing: true, design: false, promo: true, tech: true } })
    expect(gate(e, 'design', 'Design lead assigned').why).toBe('Nobody owns the creative yet')
  })

  it('holds when an act is missing a bio or a press shot', () => {
    expect(
      gate(ev({ artists: [act({ hasBio: false })] }), 'design', 'Artist bios and pics in').ok,
    ).toBe(false)
    expect(
      gate(ev({ artists: [act({ hasPromo: false })] }), 'design', 'Artist bios and pics in').ok,
    ).toBe(false)
  })

  it('ignores a declined act that never sent a bio', () => {
    const e = ev({ artists: [act(), act({ status: 'declined', hasBio: false, hasPromo: false })] })
    expect(gate(e, 'design', 'Artist bios and pics in').ok).toBe(true)
  })

  it('adds the portal chase only when there is a portal to chase in', () => {
    const withPortal = ev({ artists: [act({ hasBio: false })], hasPortal: true })
    expect(gate(withPortal, 'design', 'Artist bios and pics in').why).toContain(
      'chase it in their portal',
    )
    const without = ev({ artists: [act({ hasBio: false })], hasPortal: false })
    expect(gate(without, 'design', 'Artist bios and pics in').why).not.toContain('portal')
  })

  it('no longer says design cannot start without them, because now it can', () => {
    const g = gate(ev({ artists: [act({ hasBio: false })] }), 'design', 'Artist bios and pics in')
    expect(g.why).not.toMatch(/cannot start/)
  })

  it('needs every hero cut approved, not just one', () => {
    const assets = everyPiece().map((a) =>
      a.key === 'vertical-2' ? { ...a, state: 'review' as const } : a,
    )
    expect(gate(ev({ assets }), 'design', 'Both vertical cuts signed off').ok).toBe(false)
  })

  it('needs the cover and the listing copy signed off', () => {
    const noCover = everyPiece().map((a) =>
      a.key === 'cover' ? { ...a, state: 'draft' as const } : a,
    )
    expect(gate(ev({ assets: noCover }), 'design', 'Event cover signed off').ok).toBe(false)
    const noCopy = everyPiece().map((a) =>
      a.key === 'listing' ? { ...a, state: 'review' as const } : a,
    )
    expect(gate(ev({ assets: noCopy }), 'design', 'Listing copy signed off').ok).toBe(false)
  })

  it('counts the promoter sign-off only when they have a portal', () => {
    const unsigned = everyPiece('approved', false)
    expect(
      gate(ev({ assets: unsigned, hasPortal: false }), 'design', 'Promoter signed off the creative')
        .ok,
    ).toBe(true)

    const g = gate(
      ev({ assets: unsigned, hasPortal: true }),
      'design',
      'Promoter signed off the creative',
    )
    expect(g.ok).toBe(false)
    // The two vertical cuts and the cover — the pieces a promoter signs.
    expect(g.why).toBe('3 pieces not signed off in their portal')
  })

  it('says "piece" for one and "pieces" for more', () => {
    const one = everyPiece().map((a) => (a.key === 'cover' ? { ...a, promoterSigned: false } : a))
    expect(
      gate(ev({ assets: one, hasPortal: true }), 'design', 'Promoter signed off the creative').why,
    ).toBe('1 piece not signed off in their portal')
  })
})

// ------------------------------------------------------------------ promo ---

describe('promo — its status', () => {
  it('is not out while nothing is listed', () => {
    const e = ev({ channels: [{ live: false, stale: false }], beatsDone: 0 })
    expect(part(e, 'promo')).toMatchObject({ status: 'not out', tone: 'dim', done: false })
  })

  it('counts what is out, and how far the plan has been worked', () => {
    const e = ev({
      channels: [
        { live: true, stale: false },
        { live: false, stale: false },
        { live: false, stale: false },
      ],
      beatsDone: 1,
    })
    expect(part(e, 'promo')).toMatchObject({
      status: '1 of 3 out',
      detail: '1 of 5 beats',
      tone: 'plain',
    })
  })

  it('warns about a listing that has gone stale ahead of anything else', () => {
    const e = ev({
      channels: [
        { live: true, stale: true },
        { live: true, stale: false },
      ],
    })
    expect(part(e, 'promo')).toMatchObject({ status: '1 stale', tone: 'warn', done: false })
  })

  it('is all out when every channel is listed and the gated beats are worked', () => {
    expect(part(ev(), 'promo')).toMatchObject({ status: 'all out', tone: 'good', done: true })
  })

  it('is not done with no listings to speak of', () => {
    expect(part(ev({ channels: [] }), 'promo').done).toBe(false)
  })
})

describe('promo — its gates', () => {
  it('holds a listing that went stale after a change', () => {
    const e = ev({ channels: [{ live: true, stale: true }] })
    expect(gate(e, 'promo', 'Nothing stale on a listing').ok).toBe(false)
  })

  it('counts channels not yet out, singular and plural', () => {
    expect(
      gate(
        ev({ channels: [{ live: false, stale: false }] }),
        'promo',
        'Every channel listed or ticked off',
      ).why,
    ).toBe('1 channel not out yet')
    expect(
      gate(
        ev({
          channels: [
            { live: false, stale: false },
            { live: false, stale: false },
          ],
        }),
        'promo',
        'Every channel listed or ticked off',
      ).why,
    ).toBe('2 channels not out yet')
  })

  it('needs the announce and on-sale beats both worked', () => {
    expect(gate(ev({ beatsDone: 1 }), 'promo', 'Announce and on-sale beats done').ok).toBe(false)
    expect(gate(ev({ beatsDone: 2 }), 'promo', 'Announce and on-sale beats done').ok).toBe(true)
  })

  it('holds when nobody leads promotion', () => {
    const e = ev({ leads: { ticketing: true, design: true, promo: false, tech: true } })
    expect(gate(e, 'promo', 'Promo lead assigned').ok).toBe(false)
  })
})

// ---------------------------------------------------------------- tickets ---

describe('tickets — its status', () => {
  it('has no price while standard is zero', () => {
    expect(part(ev({ std: 0, ticketsLive: false }), 'tickets')).toMatchObject({
      status: 'no price',
      tone: 'dim',
    })
  })

  it('is priced but waiting on the booking before it is confirmed', () => {
    const e = ev({ booking: 'negotiating', ticketsLive: false })
    expect(part(e, 'tickets')).toMatchObject({ status: 'priced', detail: 'awaits booking' })
  })

  it('is priced and not on sale once the booking is confirmed', () => {
    expect(part(ev({ ticketsLive: false }), 'tickets')).toMatchObject({
      status: 'priced',
      detail: 'not on sale',
      done: false,
    })
  })

  it('is on sale with a count once Gather.rsvp is live', () => {
    expect(part(ev({ sold: 84 }), 'tickets')).toMatchObject({
      status: 'on sale',
      detail: '84 sold',
      tone: 'good',
      done: true,
    })
  })

  it('is sold out when the room is full', () => {
    expect(part(ev({ sold: 220, capacity: 220 }), 'tickets').status).toBe('sold out')
  })
})

describe('tickets — its gates', () => {
  it('holds while standard price is zero', () => {
    expect(gate(ev({ std: 0 }), 'tickets', 'Ticket tiers set').why).toBe(
      'Standard price is still zero',
    )
  })

  it('holds when nobody owns ticketing', () => {
    const e = ev({ leads: { ticketing: false, design: true, promo: true, tech: true } })
    expect(gate(e, 'tickets', 'Ticketing lead assigned').why).toBe('Nobody owns ticketing yet')
  })

  it('will not call tickets on sale before the booking is confirmed', () => {
    const g = gate(ev({ booking: 'negotiating' }), 'tickets', 'Booking confirmed')
    expect(g.ok).toBe(false)
    expect(g.why).toBe('Tickets cannot go on sale until the booking is confirmed')
  })

  /**
   * Gather.rsvp is pushed live from Promotion. The prototype pointed this at
   * Ticketing, which sets prices and has nothing that puts a show on sale —
   * a "Fix it" that lands somewhere the fix is not.
   */
  it('sends the fix to Promotion, where Gather.rsvp is pushed live', () => {
    const g = gate(ev({ ticketsLive: false }), 'tickets', 'Tickets live on Gather.rsvp')
    expect(g.ok).toBe(false)
    expect(g.screen).toBe('promo')
  })
})

/**
 * The one order between parts that still refuses. A show can be announced,
 * designed, rigged and rostered before its terms are agreed; it cannot sell a
 * ticket. Money taken for a night that may not happen is money to hand back.
 */
describe('going on sale', () => {
  it('is refused before the booking is confirmed', () => {
    for (const booking of ['enquiry', 'negotiating'] as const) {
      const v = canGoOnSale({ booking })
      expect(v.ok).toBe(false)
      expect(v.ok === false && v.why).toMatch(/booking is confirmed/)
    }
  })

  it('is allowed once it is', () => {
    expect(canGoOnSale({ booking: 'confirmed' }).ok).toBe(true)
  })
})

// ---------------------------------------------------------------- licence ---

describe('licence — its status', () => {
  it('is not needed when the bar closes before midnight and nothing was filed', () => {
    expect(part(ev(), 'licence')).toMatchObject({
      status: 'not needed',
      tone: 'dim',
      applies: false,
      done: true,
    })
  })

  it('warns when a bar past midnight has no licence recorded', () => {
    expect(part(ev({ barClose: '1:00am' }), 'licence')).toMatchObject({
      status: 'needed',
      tone: 'warn',
      applies: true,
      done: false,
    })
  })

  it('warns while a late bar’s licence is known to be required but not applied for', () => {
    expect(part(ev({ barClose: '1:00am', licence: 'required' }), 'licence')).toMatchObject({
      status: 'to apply',
      tone: 'warn',
      done: false,
    })
  })

  /**
   * The gates only ask for a licence when the bar runs past midnight, and the
   * tone follows the gates: a warning is something failing, not a hunch.
   */
  it('does not warn about a required licence the bar close does not trigger', () => {
    expect(part(ev({ licence: 'required' }), 'licence')).toMatchObject({
      status: 'to apply',
      tone: 'plain',
      applies: true,
    })
  })

  it('reads applied, confirmed and denied as they are', () => {
    expect(part(ev({ barClose: '1:00am', licence: 'applied_for' }), 'licence')).toMatchObject({
      status: 'applied',
      tone: 'plain',
      done: false,
    })
    expect(part(ev({ barClose: '1:00am', licence: 'confirmed' }), 'licence')).toMatchObject({
      status: 'confirmed',
      tone: 'good',
      done: true,
    })
    expect(part(ev({ licence: 'denied' }), 'licence')).toMatchObject({
      status: 'denied',
      tone: 'stop',
      done: false,
    })
  })
})

describe('licence — its gates', () => {
  it('needs no licence when the bar closes before midnight', () => {
    const e = ev({ barClose: '11:00pm', licence: 'not_required' })
    expect(gate(e, 'licence', 'Licence filed if it is needed').ok).toBe(true)
  })

  it('holds a bar running past midnight with no licence recorded', () => {
    // The gate that stops the venue trading unlawfully. Worth its own case.
    const g = gate(
      ev({ barClose: '1:00am', licence: 'not_required' }),
      'licence',
      'Licence filed if it is needed',
    )
    expect(g.ok).toBe(false)
    expect(g.why).toBe('Bar runs past midnight with no licence recorded')
  })

  it('accepts a late bar once the licence is at least applied for', () => {
    expect(
      gate(
        ev({ barClose: '1:00am', licence: 'applied_for' }),
        'licence',
        'Licence filed if it is needed',
      ).ok,
    ).toBe(true)
  })

  it('stops outright on a denied licence, however early the bar closes', () => {
    expect(
      gate(ev({ barClose: '9:00pm', licence: 'denied' }), 'licence', 'Special licence not denied')
        .ok,
    ).toBe(false)
  })

  it('needs the licence confirmed, not merely applied for, once past midnight', () => {
    expect(
      gate(
        ev({ barClose: '1:00am', licence: 'applied_for' }),
        'licence',
        'Licence confirmed if needed',
      ).ok,
    ).toBe(false)
    expect(
      gate(
        ev({ barClose: '1:00am', licence: 'confirmed' }),
        'licence',
        'Licence confirmed if needed',
      ).ok,
    ).toBe(true)
  })

  it('reads the licence state as words inside the sentence', () => {
    const g = gate(
      ev({ barClose: '2:00am', licence: 'applied_for' }),
      'licence',
      'Licence confirmed if needed',
    )
    expect(g.why).toBe('Bar past midnight and the licence is applied for')
  })
})

// ------------------------------------------------------------------- tech ---

describe('tech — its status', () => {
  it('has not started while the plan is a draft nobody leads', () => {
    const e = ev({
      techStatus: 'draft',
      leads: { ticketing: true, design: true, promo: true, tech: false },
    })
    expect(part(e, 'tech')).toMatchObject({ status: 'draft', detail: 'no lead', tone: 'dim' })
  })

  it('reads a led draft as in progress, naming missing riders', () => {
    const e = ev({ techStatus: 'draft', artists: [act({ hasTechRider: false }), act()] })
    expect(part(e, 'tech')).toMatchObject({ status: 'draft', detail: '1 rider out', tone: 'plain' })
  })

  it('is confirmed when the plan is signed and every gate is clear', () => {
    expect(part(ev(), 'tech')).toMatchObject({ status: 'confirmed', tone: 'good', done: true })
  })

  it('counts what is still to clear on a confirmed plan', () => {
    expect(part(ev({ doors: null }), 'tech')).toMatchObject({
      status: 'confirmed',
      detail: '1 to clear',
      tone: 'plain',
      done: false,
    })
  })
})

describe('tech — its gates', () => {
  it('names the state a tech plan is still in', () => {
    expect(gate(ev({ techStatus: 'draft' }), 'tech', 'Tech plan confirmed').why).toBe(
      'Plan is still draft',
    )
  })

  it('counts acts without a tech rider', () => {
    expect(
      gate(ev({ artists: [act({ hasTechRider: false })] }), 'tech', 'Tech riders in').why,
    ).toBe('1 act without a rider')
  })

  it('needs both run times, not one', () => {
    expect(gate(ev({ doors: null }), 'tech', 'Run times set').ok).toBe(false)
    expect(gate(ev({ allOut: null }), 'tech', 'Run times set').ok).toBe(false)
    expect(gate(ev(), 'tech', 'Run times set').ok).toBe(true)
  })

  it('needs a service window for the bar', () => {
    expect(gate(ev({ barClose: null }), 'tech', 'Bar session set').ok).toBe(false)
  })

  it('holds when nobody owns production', () => {
    const e = ev({ leads: { ticketing: true, design: true, promo: true, tech: false } })
    expect(gate(e, 'tech', 'Tech lead assigned').why).toBe('Nobody owns production')
  })
})

// ----------------------------------------------------------------- roster ---

describe('roster — its status', () => {
  it('has nothing to fill before shifts exist', () => {
    expect(part(ev({ shifts: [] }), 'roster')).toMatchObject({
      status: 'no shifts',
      tone: 'dim',
      done: false,
    })
  })

  it('counts open shifts against the whole roster', () => {
    const e = ev({
      shifts: [
        { assigned: false, pencilled: false },
        { assigned: true, pencilled: false },
        { assigned: false, pencilled: false },
      ],
    })
    expect(part(e, 'roster')).toMatchObject({ status: '2 open', detail: 'of 3', tone: 'plain' })
  })

  it('counts pencilled crew once every shift has somebody', () => {
    const e = ev({ shifts: [{ assigned: true, pencilled: true }] })
    expect(part(e, 'roster').status).toBe('1 pencilled')
  })

  it('is filled when every shift is confirmed', () => {
    expect(part(ev(), 'roster')).toMatchObject({ status: 'filled', tone: 'good', done: true })
  })
})

describe('roster — its gates', () => {
  it('counts open shifts, singular and plural', () => {
    expect(
      gate(ev({ shifts: [{ assigned: false, pencilled: false }] }), 'roster', 'Every shift filled')
        .why,
    ).toBe('1 shift still open')
  })

  it('treats a pencilled shift as filled but not settled', () => {
    const e = ev({ shifts: [{ assigned: true, pencilled: true }] })
    expect(gate(e, 'roster', 'Every shift filled').ok).toBe(true)
    expect(gate(e, 'roster', 'Nothing left pencilled').ok).toBe(false)
  })
})

// ------------------------------------------------------------- settlement ---

describe('settlement — its status', () => {
  it('has nothing to settle before the night', () => {
    expect(part(ev({ daysToDoor: 3 }), 'settlement')).toMatchObject({
      status: 'not yet',
      tone: 'dim',
      applies: false,
    })
  })

  it('has nothing to settle on a show that was never booked', () => {
    expect(part(ev({ booking: 'negotiating', daysToDoor: -2 }), 'settlement')).toMatchObject({
      status: 'not booked',
      tone: 'dim',
      applies: false,
    })
  })

  it('wants counting once the night has come, naming the half still out', () => {
    expect(
      part(ev({ daysToDoor: 0, doorCounted: false, barClosed: false }), 'settlement'),
    ).toMatchObject({ status: 'to count', detail: null, tone: 'warn', applies: true })
    expect(part(ev({ daysToDoor: -1, barClosed: false }), 'settlement').detail).toBe('bar')
    expect(part(ev({ daysToDoor: -1, doorCounted: false }), 'settlement').detail).toBe('door')
  })

  it('is counted, and ready, once both halves and the hours are in', () => {
    expect(part(ev({ daysToDoor: -1 }), 'settlement')).toMatchObject({
      status: 'counted',
      detail: 'ready',
      tone: 'plain',
      clear: true,
      done: false,
    })
    expect(
      part(ev({ daysToDoor: -1, hoursLogged: 0, tasksWithActual: 0 }), 'settlement').detail,
    ).toBe('hours out')
  })

  it('is closed once the event is put to bed', () => {
    expect(part(ev({ daysToDoor: -9, concluded: true }), 'settlement')).toMatchObject({
      status: 'closed',
      tone: 'good',
      done: true,
    })
  })
})

describe('settlement — its gates', () => {
  const night = (over: Partial<PartsEvent> = {}) => ev({ daysToDoor: -1, ...over })

  it('accepts either a timesheet row or a task actual as time logged', () => {
    expect(
      gate(
        night({ hoursLogged: 0, tasksWithActual: 1 }),
        'settlement',
        'Hours logged for this event',
      ).ok,
    ).toBe(true)
    expect(
      gate(
        night({ hoursLogged: 2, tasksWithActual: 0 }),
        'settlement',
        'Hours logged for this event',
      ).ok,
    ).toBe(true)
    expect(
      gate(
        night({ hoursLogged: 0, tasksWithActual: 0 }),
        'settlement',
        'Hours logged for this event',
      ).ok,
    ).toBe(false)
  })

  it('holds until the bar take and ticket count are reconciled', () => {
    const g = gate(night({ doorCounted: false, barClosed: false }), 'settlement', 'Actuals in')
    expect(g.ok).toBe(false)
    expect(g.why).toBe('Bar take and final ticket count not reconciled')
  })

  /**
   * The door and the bar are reconciled separately, by different people. One
   * half in is not the night counted, so the gate waits for both and names the
   * one still missing.
   */
  it('names the half still missing', () => {
    expect(gate(night({ barClosed: false }), 'settlement', 'Actuals in').why).toBe(
      'Bar take not reconciled',
    )
    expect(gate(night({ doorCounted: false }), 'settlement', 'Actuals in').why).toBe(
      'Final ticket count not reconciled',
    )
    expect(gate(night(), 'settlement', 'Actuals in').ok).toBe(true)
  })

  /**
   * The fix link goes where the missing half is entered: the bar is closed in
   * Bar, off the till, and the door is counted on the event record.
   */
  it('sends the fix to Bar while the bar is open, and to the event record for the door', () => {
    expect(gate(night({ barClosed: false }), 'settlement', 'Actuals in').screen).toBe('bar')
    expect(
      gate(night({ doorCounted: false, barClosed: false }), 'settlement', 'Actuals in').screen,
    ).toBe('bar')
    expect(gate(night({ doorCounted: false }), 'settlement', 'Actuals in').screen).toBe('event')
  })
})

// ------------------------------------------------------------ what's next ---

/**
 * Only two things are still moved by a person pressing a button: the booking,
 * and putting a finished night to bed. Everything else is worked out from the
 * records the modules keep, so there is nothing to press.
 */
describe('the next move on an event', () => {
  it('moves an enquiry on to negotiating', () => {
    const m = nextMove(ev({ booking: 'enquiry' }))
    expect(m).toMatchObject({
      kind: 'booking',
      label: 'Move to Negotiating',
      title: 'Before this moves to Negotiating',
      clear: true,
      message: 'Everything is clear — this can move to Negotiating.',
    })
  })

  it('confirms a negotiation, naming the first thing in the way', () => {
    const m = nextMove(ev({ booking: 'negotiating', split: 0 }))
    expect(m).toMatchObject({
      kind: 'booking',
      label: 'Confirm the booking',
      title: 'Before the booking is confirmed',
      clear: false,
      message: 'One thing holds this up: split agreed.',
    })
  })

  it('has nothing to press on a confirmed booking before its night', () => {
    expect(nextMove(ev({ daysToDoor: 5 }))).toBeNull()
  })

  it('puts the night to bed once it has happened and the gates are clear', () => {
    expect(nextMove(ev({ daysToDoor: 0 }))).toMatchObject({
      kind: 'settle',
      label: 'Put to bed',
      title: 'Before this is put to bed',
      clear: true,
      message: 'Everything is clear — this event can be put to bed.',
    })
    expect(nextMove(ev({ daysToDoor: -3, barClosed: false }))?.clear).toBe(false)
  })

  it('moves the booking first on a night that came before it was confirmed', () => {
    expect(nextMove(ev({ booking: 'negotiating', daysToDoor: -2 }))?.kind).toBe('booking')
  })

  it('has nothing left once the event is concluded', () => {
    expect(nextMove(ev({ daysToDoor: -9, concluded: true }))).toBeNull()
  })
})

// ------------------------------------------------------------ no gate lost ---

/**
 * Every condition the eight stage gates held, by its label.
 *
 * The gates are specification: a gate that quietly drops out is a show that
 * sells a late bar without a licence. When the stages became parts, every
 * condition moved to the part it belongs to rather than being rewritten, and
 * this list is what proves none fell out on the way.
 *
 * One was merged rather than moved. "Door list pulled" tested exactly what
 * "Tickets live on Gather.rsvp" tests — the door list is Gather's — so it
 * survives as that gate.
 */
const STAGE_GATES = [
  // Enquiry
  'An owner is named',
  'Date is locked',
  'Space chosen',
  'Kind of night set',
  // Negotiating
  'Booking contact named',
  'At least one act confirmed',
  'Fee floor and ceiling agreed',
  'Split agreed',
  'Terms agreed with the promoter',
  'Bar close decided',
  // Confirmed
  'Ticketing lead assigned',
  'Design lead assigned',
  'Ticket tiers set',
  'Artist bios and pics in',
  'Licence filed if it is needed',
  'Special licence not denied',
  // Design
  'Both vertical cuts signed off',
  'Event cover signed off',
  'Listing copy signed off',
  'Promo lead assigned',
  'Promoter signed off the creative',
  // On sale
  'Tickets live on Gather.rsvp',
  'Every channel listed or ticked off',
  'Nothing stale on a listing',
  'Announce and on-sale beats done',
  // Rostering
  'Every shift filled',
  'Nothing left pencilled',
  'Tech lead assigned',
  'Tech plan confirmed',
  'Tech riders in',
  // Show week
  'Licence confirmed if needed',
  'Run times set',
  'Bar session set',
  // Payout
  'Hours logged for this event',
  'Actuals in',
]

describe('the stage gates, now held by parts', () => {
  const everyGate = () => {
    const labels = new Set<string>()
    for (const booking of ['enquiry', 'negotiating', 'confirmed'] as const) {
      for (const p of partsFor(ev({ booking, daysToDoor: -1 }))) {
        for (const g of p.checks) labels.add(g.label)
      }
    }
    return labels
  }

  it('keeps every condition the stages had', () => {
    const labels = everyGate()
    expect(STAGE_GATES.filter((l) => !labels.has(l))).toEqual([])
  })

  it('adds only the rule that tickets wait for the booking', () => {
    const labels = [...everyGate()]
    expect(labels.filter((l) => !STAGE_GATES.includes(l))).toEqual(['Booking confirmed'])
  })
})

/**
 * A gate's whole value is that it tells you where to go and fix the thing. A
 * gate pointing at a module nobody can open still reads as an actionable step,
 * so this walks every part on both sides of the gates that choose their link.
 */
describe('gate deep links', () => {
  it('every gate points at the event record or a module that is built', () => {
    const targets = new Set<string>()
    for (const booking of ['enquiry', 'negotiating', 'confirmed'] as const) {
      for (const e of [
        ev({ booking, daysToDoor: -1 }),
        ev({ booking, daysToDoor: -1, doorCounted: false, barClosed: false }),
      ]) {
        for (const p of partsFor(e)) for (const g of p.checks) targets.add(g.screen)
      }
    }
    const allowed = new Set<string>(['event', ...BUILT_MODULES])
    expect([...targets].filter((t) => !allowed.has(t))).toEqual([])
  })
})
