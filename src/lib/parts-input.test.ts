import { describe, expect, it } from 'vitest'
import { partsInputFor, type PartsRow } from './parts-input'

/**
 * Turning an event row into what the parts read.
 *
 * The Pipeline and the event record both show an event's parts, and both go
 * through this — so it is the one place a wrong reading of a row would make
 * every screen agree on something untrue. These are the rules in it that are
 * easy to get quietly wrong.
 */

const NOW = new Date(2026, 8, 16, 14, 0)

const row = (over: Partial<PartsRow> = {}): PartsRow => ({
  bookingStatus: 'NEGOTIATING',
  bookingStatusSince: new Date(2026, 8, 12, 9, 0),
  concluded: false,
  date: new Date(2026, 8, 26, 20, 0),
  dateTbc: false,
  kind: 'live',
  format: 'Live music',
  promoter: 'Kōura Records',
  ownerId: 'person_mere',
  split: 0.6,
  deal: 'SENT',
  dealNote: null,
  barClose: '12:00am',
  doors: '8:00pm',
  allOut: '12:30am',
  licence: 'APPLIED_FOR',
  techStatus: 'DRAFT',
  std: 30,
  sold: 12,
  space: { name: 'Main', capacity: 220, seatedCapacity: 150 },
  leads: [{ role: 'DESIGN' }, { role: 'TECH' }],
  assets: [{ key: 'cover', state: 'REVIEW', promoterSigned: false, signedById: null }],
  channels: [
    { channel: 'gather', live: false, stale: false },
    { channel: 'facebook-event', live: true, stale: true },
  ],
  beats: [{ done: true }, { done: false }],
  artists: [],
  files: [],
  shifts: [],
  tasks: [],
  hours: [],
  ...over,
})

const extras = { hasPortal: false, floor: 400, ceil: 900, actual: null, now: NOW }

describe('partsInputFor', () => {
  it('reads the booking status and how long it has sat there', () => {
    const e = partsInputFor(row(), extras)
    expect(e.booking).toBe('negotiating')
    expect(e.bookingDays).toBe(4)
  })

  it('counts days to the door by calendar day', () => {
    expect(partsInputFor(row(), extras).daysToDoor).toBe(10)
  })

  it('lowercases the enums the parts compare against', () => {
    const e = partsInputFor(row(), extras)
    expect(e.dealState).toBe('sent')
    expect(e.licence).toBe('applied_for')
    expect(e.techStatus).toBe('draft')
    expect(e.assets).toEqual([
      { key: 'cover', state: 'review', promoterSigned: false, signedById: null },
    ])
  })

  it('knows a lead by the presence of a row, not by who it is', () => {
    expect(partsInputFor(row(), extras).leads).toEqual({
      ticketing: false,
      design: true,
      promo: false,
      tech: true,
    })
  })

  /**
   * Gather.rsvp is the source of truth for being on sale. Any other channel
   * being live is a listing, and a listing can go out before the booking is
   * confirmed where a ticket cannot.
   */
  it('is on sale only when Gather.rsvp is live, not when any channel is', () => {
    expect(partsInputFor(row(), extras).ticketsLive).toBe(false)
    const live = row({ channels: [{ channel: 'gather', live: true, stale: false }] })
    expect(partsInputFor(live, extras).ticketsLive).toBe(true)
  })

  it('takes capacity from the room, seated for a cabaret', () => {
    expect(partsInputFor(row(), extras).capacity).toBe(220)
    expect(partsInputFor(row({ format: 'Cabaret' }), extras).capacity).toBe(150)
  })

  it('counts artwork that is current and was not blocked by the scan', () => {
    const files = [
      { kind: 'ARTWORK', assetId: 'a1', current: true, scan: 'CLEAN' },
      // Still being scanned: it arrived, which is what "assets in" means.
      { kind: 'ARTWORK', assetId: 'a2', current: true, scan: 'PENDING' },
      { kind: 'ARTWORK', assetId: 'a3', current: true, scan: 'BLOCKED' },
      { kind: 'ARTWORK', assetId: 'a1', current: false, scan: 'CLEAN' },
      { kind: 'PRESS_SHOT', assetId: null, current: true, scan: 'CLEAN' },
    ]
    expect(partsInputFor(row({ files }), extras).artworkFiles).toBe(2)
  })

  it('counts an act’s file whether it came in on the payee or on the event', () => {
    const e = partsInputFor(
      row({
        artists: [
          { status: 'CONFIRMED', payee: { files: [{ kind: 'PRESS_SHOT' }, { kind: 'BIO' }] } },
          { status: 'PENCILLED', payee: null },
        ],
        files: [{ kind: 'RIDER_TECH', assetId: null, current: true, scan: 'CLEAN' }],
      }),
      extras,
    )
    expect(e.artists).toEqual([
      { status: 'confirmed', hasPromo: true, hasBio: true, hasTechRider: true },
      { status: 'pencilled', hasPromo: false, hasBio: false, hasTechRider: true },
    ])
  })

  it('reads a shift as assigned by its person, and pencilled by its state', () => {
    const e = partsInputFor(
      row({
        shifts: [
          { personId: 'p1', state: 'ASSIGNED' },
          { personId: 'p2', state: 'ASKED' },
          { personId: null, state: 'OPEN' },
        ],
      }),
      extras,
    )
    expect(e.shifts).toEqual([
      { assigned: true, pencilled: false },
      { assigned: true, pencilled: true },
      { assigned: false, pencilled: false },
    ])
  })

  it('counts hours rows and only the tasks that carry an actual', () => {
    const e = partsInputFor(
      row({
        hours: [{}, {}],
        tasks: [{ actual: 3 }, { actual: 0 }, { actual: null }],
      }),
      extras,
    )
    expect(e.hoursLogged).toBe(2)
    expect(e.tasksWithActual).toBe(1)
  })

  it('reads each half of the night as in only when both its figures are', () => {
    const e = partsInputFor(row(), {
      ...extras,
      actual: { tickets: 140, ticketRev: 3900, barTake: null, barProfit: null },
    })
    expect(e.doorCounted).toBe(true)
    expect(e.barClosed).toBe(false)
  })

  it('works the beats done out of the rows, and carries the fee range through', () => {
    const e = partsInputFor(row(), extras)
    expect(e.beatsDone).toBe(1)
    expect([e.floor, e.ceil]).toEqual([400, 900])
  })
})
