import { describe, expect, it } from 'vitest'
import { DEFAULT_PERMS, type ModuleKey, type RoleKey } from './constants'
import { ASSET_SET, type AssetState, type EventAsset } from './design'
import { CFG } from './finance'
import { money } from './format'
import { partsFor, type GateArtist, type PartsEvent } from './parts'
import { SOON_DAYS } from './pipeline'
import {
  actorsOf,
  GATE_ACTION,
  greeting,
  homeRefusal,
  homeSub,
  homeTiles,
  inRevenueWindow,
  landingFor,
  myHours,
  needsCount,
  needsFor,
  nextNight,
  pickNext,
  splitNeeds,
  type Actors,
  type HomeEvent,
  type Need,
  type Viewer,
} from './home'

// ------------------------------------------------------------- fixtures ---

/**
 * A confirmed night three weeks out with every part finished. Each test
 * spoils what it is about, so a failure names the ask it broke.
 */
const act = (over: Partial<GateArtist> = {}): GateArtist => ({
  status: 'confirmed',
  hasPromo: true,
  hasBio: true,
  hasTechRider: true,
  ...over,
})

const everyPiece = (state: AssetState = 'approved'): EventAsset[] =>
  ASSET_SET.map((a) => ({
    key: a.key,
    state,
    promoterSigned: true,
    signedById: state === 'approved' ? 'user_signer' : null,
  }))

/** The house set approved, but for the first `n` pieces, which are up for sign-off. */
const inReview = (n: number): EventAsset[] =>
  ASSET_SET.map((a, i) => ({
    key: a.key,
    state: i < n ? 'review' : 'approved',
    promoterSigned: true,
    signedById: i < n ? null : 'user_signer',
  }))

const input = (over: Partial<PartsEvent> = {}): PartsEvent => ({
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
  allOut: '11:30pm',
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
  doorCounted: false,
  barClosed: false,
  ...over,
})

// The people behind the accounts, and one with no account at all.
const MT = 'person-mt' // Event coordinator
const TW = 'person-tw' // Design & comms
const JR = 'person-jr' // Technical production
const AK = 'person-ak' // Bar & duty manager
const SL = 'person-sl' // Super admin
const SP = 'person-sp' // on the books, never signed in

const ROLE_OF: Record<string, RoleKey> = {
  [MT]: 'coordinator',
  [TW]: 'design',
  [JR]: 'tech',
  [AK]: 'bar',
  [SL]: 'admin',
}

const actors: Actors = new Map(
  Object.entries(ROLE_OF).map(([person, role]) => [person, DEFAULT_PERMS[role]]),
)

const as = (person: string): Viewer => ({
  personId: person,
  modules: DEFAULT_PERMS[ROLE_OF[person]!],
})

const night = (over: Partial<HomeEvent> = {}, parts: Partial<PartsEvent> = {}): HomeEvent => ({
  id: 'sb',
  name: 'Static Bloom',
  date: new Date(2026, 9, 7, 20, 0),
  spaceName: 'Main',
  format: 'DJs',
  ownerId: MT,
  leads: { ticketing: MT, design: TW, promo: TW, tech: JR },
  riskNote: null,
  ...over,
  input: input(parts),
})

const titles = (needs: Need[]) => needs.map((n) => n.title)
const one = (needs: Need[], title: string): Need => {
  const found = needs.find((n) => n.title === title)
  if (!found) throw new Error(`no need "${title}" — have: ${titles(needs).join(' | ')}`)
  return found
}

const LATE = { barClose: '1:00am', allOut: '1:30am' } as const

// ------------------------------------------------------------ needs you ---

describe('Needs you — a finished night', () => {
  it('asks nothing of anyone', () => {
    for (const person of Object.keys(ROLE_OF)) {
      expect(needsFor([night()], as(person), actors)).toEqual([])
    }
  })
})

describe('Needs you — whose it is', () => {
  it("gives an event's own business to its owner, and not to others who could open it", () => {
    const e = night({}, { ...LATE, licence: 'required' })

    const mine = needsFor([e], as(MT), actors)
    expect(titles(mine)).toEqual(['Apply for the special licence — Static Bloom'])
    expect(mine[0]!.claim).toBe('yours')
    expect(mine[0]!.href).toBe('/events/sb')

    // The admin can open everything the owner can, and it is still not theirs.
    expect(needsFor([e], as(SL), actors)).toEqual([])
  })

  it('hands it to whoever can open Finance when nobody who could act owns it', () => {
    const late = { ...LATE, licence: 'required' as const }
    // The owner's role cannot open the event record; the owner has no
    // account; there is no owner at all.
    for (const ownerId of [AK, SP, null]) {
      const e = night({ ownerId }, late)

      const coordinator = needsFor([e], as(MT), actors)
      expect(titles(coordinator)).toEqual(['Apply for the special licence — Static Bloom'])
      expect(coordinator[0]!.claim).toBe('unclaimed')
      expect(titles(needsFor([e], as(SL), actors))).toHaveLength(1)

      // Design can open the event record, but a licence is not design's to chase.
      expect(needsFor([e], as(TW), actors)).toEqual([])
      expect(needsFor([e], as(AK), actors)).toEqual([])
    }
  })

  it("gives a department's part to its lead", () => {
    const e = night({}, { assets: inReview(1) })

    expect(titles(needsFor([e], as(TW), actors))).toEqual(['Approve artwork — Static Bloom'])
    // The coordinator can open Design, but Tui leads it.
    expect(needsFor([e], as(MT), actors)).toEqual([])
  })

  it("opens a department's part to everyone who can open it when nobody leads it who could", () => {
    // No design lead; a design lead whose role cannot open Design; one who never signed in.
    for (const design of [undefined, AK, SP]) {
      const e = night(
        { leads: { ticketing: MT, promo: TW, tech: JR, design } },
        {
          assets: inReview(1),
        },
      )

      for (const person of [MT, TW, SL]) {
        const needs = needsFor([e], as(person), actors)
        expect(titles(needs)).toEqual(['Approve artwork — Static Bloom'])
        expect(needs[0]!.claim).toBe('unclaimed')
      }
      expect(needsFor([e], as(JR), actors)).toEqual([])
    }
  })

  it('puts a roster gap in front of everyone who can open the roster', () => {
    const shifts = [
      { assigned: true, pencilled: false },
      { assigned: false, pencilled: false },
      { assigned: false, pencilled: false },
      { assigned: false, pencilled: false },
    ]
    const e = night({}, { daysToDoor: 8, shifts })

    for (const person of [MT, JR, AK, SL]) {
      const needs = needsFor([e], as(person), actors)
      expect(titles(needs)).toEqual(['Fill 3 shifts — Static Bloom'])
      expect(needs[0]).toMatchObject({
        sub: '1 of 4 filled',
        href: '/roster?event=sb',
        claim: null,
      })
    }
    expect(needsFor([e], as(TW), actors)).toEqual([])
  })

  it('splits a night still to count between the bar and the door', () => {
    const e = night({}, { daysToDoor: -2 })

    const bar = needsFor([e], as(AK), actors)
    expect(titles(bar)).toEqual(['Close the bar — Static Bloom'])
    expect(bar[0]).toMatchObject({
      sub: 'Bar take not reconciled',
      href: '/bar?event=sb',
      when: '2d ago',
      tone: 'warn',
      claim: null,
    })

    const owner = needsFor([e], as(MT), actors)
    expect(titles(owner)).toEqual(['Close the bar — Static Bloom', 'Count the door — Static Bloom'])
    expect(one(owner, 'Count the door — Static Bloom')).toMatchObject({
      sub: 'Final ticket count not reconciled',
      href: '/events/sb',
      claim: 'yours',
    })
  })

  it('leads with the first thing the reader can fix, and counts what else they can', () => {
    const e = night(
      {},
      { daysToDoor: 5, techStatus: 'draft', artists: [act({ hasTechRider: false })] },
    )

    const tech = needsFor([e], as(JR), actors)
    expect(tech.map((n) => [n.title, n.sub])).toEqual([
      ['Confirm the tech plan — Static Bloom', 'Plan is still draft · 1 more'],
    ])

    // Without the event record, the rider is not theirs to chase from here.
    const techOnly: Viewer = { personId: JR, modules: ['home', 'tech'] }
    const narrow: Actors = new Map([...actors, [JR, techOnly.modules]])
    expect(needsFor([e], techOnly, narrow).map((n) => n.sub)).toEqual(['Plan is still draft'])
  })

  it('leaves out anything the reader could not open', () => {
    // Ana owns this booking, but Bar cannot open the event record — so it
    // is not hers to be asked about, and it goes to Finance instead.
    const e = night({ ownerId: AK }, { booking: 'negotiating', dealState: 'sent' })

    expect(needsFor([e], as(AK), actors)).toEqual([])
    expect(titles(needsFor([e], as(MT), actors))).toEqual([
      'Agree terms with the promoter — Static Bloom',
    ])
  })
})

describe('Needs you — what counts as today', () => {
  const draft = { techStatus: 'draft' as const }

  it('leaves unfinished work on a night beyond the next 30 days to the Pipeline', () => {
    expect(needsFor([night({}, { ...draft, daysToDoor: SOON_DAYS + 1 })], as(JR), actors)).toEqual(
      [],
    )
    expect(
      titles(needsFor([night({}, { ...draft, daysToDoor: SOON_DAYS })], as(JR), actors)),
    ).toEqual(['Confirm the tech plan — Static Bloom'])
  })

  it("keeps a flagged night's unfinished work on the list, however far out", () => {
    const e = night({ riskNote: 'Rider still missing' }, { ...draft, daysToDoor: 60 })
    expect(titles(needsFor([e], as(JR), actors))).toEqual(['Confirm the tech plan — Static Bloom'])
  })

  it('lists a part that wants attention, however far out', () => {
    const licence = night({}, { ...LATE, licence: 'required', daysToDoor: 60 })
    expect(titles(needsFor([licence], as(MT), actors))).toEqual([
      'Apply for the special licence — Static Bloom',
    ])

    const stale = night(
      {},
      {
        daysToDoor: 60,
        channels: [
          { live: true, stale: true },
          { live: true, stale: true },
          { live: true, stale: false },
        ],
      },
    )
    const needs = needsFor([stale], as(TW), actors)
    expect(titles(needs)).toEqual(['2 listings stale — Static Bloom'])
    expect(needs[0]).toMatchObject({
      sub: 'Changed since it went out',
      href: '/promo?event=sb',
      tone: 'warn',
      when: '60d out',
    })
  })

  it('lists artwork waiting for sign-off, however far out', () => {
    const needs = needsFor([night({}, { assets: inReview(2), daysToDoor: 60 })], as(TW), actors)
    expect(needs).toHaveLength(1)
    expect(needs[0]).toMatchObject({
      title: 'Approve artwork — Static Bloom',
      sub: '2 pieces waiting for sign-off',
      href: '/design?event=sb',
    })
  })

  it('asks for sign-off on a piece no gate counts, even once the design is otherwise done', () => {
    // The story and the poster hold up no gate, so the design reads finished
    // with one of them still waiting on somebody's eye.
    const assets = ASSET_SET.map((a) => ({
      key: a.key,
      state: (a.key === 'story' ? 'review' : 'approved') as AssetState,
      promoterSigned: true,
      signedById: a.key === 'story' ? null : 'user_signer',
    }))
    const e = night({}, { assets })
    expect(partsFor(e.input).find((p) => p.key === 'design')?.done).toBe(true)

    expect(needsFor([e], as(TW), actors)).toMatchObject([
      { title: 'Approve artwork — Static Bloom', sub: '1 piece waiting for sign-off' },
    ])
  })

  it('asks a department nothing while the booking is unconfirmed, unless something waits on it', () => {
    const e = night({}, { ...draft, booking: 'negotiating', dealState: 'sent', daysToDoor: 10 })

    expect(needsFor([e], as(JR), actors)).toEqual([])
    expect(titles(needsFor([e], as(MT), actors))).toEqual([
      'Agree terms with the promoter — Static Bloom',
    ])

    // A promoter's tour artwork, in with the enquiry, still wants signing off.
    const early = night({}, { booking: 'enquiry', assets: inReview(1), daysToDoor: 10 })
    expect(titles(needsFor([early], as(TW), actors))).toEqual(['Approve artwork — Static Bloom'])
  })

  it('lists an unconfirmed booking however far out, on its own clock', () => {
    const e = night({}, { booking: 'enquiry', bookingDays: 5, dateTbc: true, daysToDoor: 90 })

    const needs = needsFor([e], as(MT), actors)
    expect(needs).toHaveLength(1)
    expect(needs[0]).toMatchObject({
      title: 'Lock the date — Static Bloom',
      sub: 'The enquiry still says date TBC',
      when: '2d over',
      tone: 'warn',
      href: '/events/sb',
    })
  })

  it("stops asking about a night's departments once the night has passed", () => {
    const e = night({}, { ...draft, daysToDoor: -1, doorCounted: true, barClosed: true })

    expect(needsFor([e], as(JR), actors)).toEqual([])
    expect(titles(needsFor([e], as(MT), actors))).toEqual(['Put to bed — Static Bloom'])
  })

  it('asks nothing about a night that has been put to bed', () => {
    const e = night({}, { ...draft, concluded: true, daysToDoor: -10 })
    for (const person of Object.keys(ROLE_OF)) {
      expect(needsFor([e], as(person), actors)).toEqual([])
    }
  })
})

describe('Needs you — the moves a person makes by hand', () => {
  it('offers the booking move once its gates are clear', () => {
    const e = night({}, { booking: 'negotiating', dealState: 'agreed' })
    expect(needsFor([e], as(MT), actors)).toMatchObject([
      {
        title: 'Confirm the booking — Static Bloom',
        sub: 'Everything is clear — the booking can be confirmed.',
        href: '/events/sb',
      },
    ])

    const enquiry = night({}, { booking: 'enquiry', bookingDays: 1 })
    expect(needsFor([enquiry], as(MT), actors)).toMatchObject([
      { title: 'Move to Negotiating — Static Bloom', when: '2d left' },
    ])
  })

  it("answers a query in the promoter's own words", () => {
    const e = night(
      {},
      { booking: 'negotiating', dealState: 'queried', dealNote: 'Fee is too low' },
    )
    expect(needsFor([e], as(MT), actors)).toMatchObject([
      { title: 'Answer their query — Static Bloom', sub: 'They queried it: Fee is too low' },
    ])
  })

  it('asks for an agreement without pointing at a page the reader is not on', () => {
    const e = night({}, { booking: 'negotiating', dealState: 'sent', hasPortal: false })
    const [need] = needsFor([e], as(MT), actors)
    expect(need!.sub).toBe('Record it on the event record once they say yes')
  })

  it('offers putting a counted night to bed, and asks for hours first when there are none', () => {
    const counted = { daysToDoor: -3, doorCounted: true, barClosed: true }
    expect(needsFor([night({}, counted)], as(MT), actors)).toMatchObject([
      {
        title: 'Put to bed — Static Bloom',
        sub: 'Everything is clear — this event can be put to bed.',
        tone: 'plain',
      },
    ])

    const noHours = night({}, { ...counted, hoursLogged: 0, tasksWithActual: 0 })
    expect(needsFor([noHours], as(MT), actors)).toMatchObject([
      {
        title: 'Log the hours — Static Bloom',
        sub: 'Nobody has logged their time',
        href: '/hours?event=sb',
      },
    ])
  })
})

describe('actorsOf — who could act on something', () => {
  const byRole = new Map<string, ModuleKey[]>([
    ['COORDINATOR', ['home', 'pipeline', 'roster']],
    ['BAR', ['home', 'bar']],
  ])

  it("is the person behind each account, with what that account's role opens", () => {
    const found = actorsOf(
      [
        { personId: MT, role: 'COORDINATOR' },
        { personId: AK, role: 'BAR' },
      ],
      byRole,
    )
    expect([...found]).toEqual([
      [MT, ['home', 'pipeline', 'roster']],
      [AK, ['home', 'bar']],
    ])
  })

  it('leaves out an account with nobody behind it, and opens nothing for a role with no rows', () => {
    const found = actorsOf(
      [
        { personId: null, role: 'COORDINATOR' },
        { personId: JR, role: 'TECH' },
      ],
      byRole,
    )
    expect([...found]).toEqual([[JR, []]])
  })
})

describe('Needs you — a booking whose date has gone', () => {
  it('still asks its owner to move it on, because nothing else will say so', () => {
    // Departments stop once the night has passed. A booking that never got as
    // far as confirmed is not a night that happened, though: it sits on the
    // Pipeline until somebody deals with it, and this is the only reminder.
    const lapsed = night({}, { booking: 'negotiating', daysToDoor: -5, shifts: [] })
    const needs = needsFor([lapsed], as(MT), actors)
    expect(needs.map((n) => n.href)).toEqual(['/events/sb'])
    expect(needs[0]!.title).toMatch(/Static Bloom/)
  })

  it('asks nothing of the departments for it', () => {
    const lapsed = night(
      {},
      { booking: 'negotiating', daysToDoor: -5, techStatus: 'draft', assets: inReview(2) },
    )
    for (const who of [TW, JR, AK]) expect(needsFor([lapsed], as(who), actors)).toEqual([])
  })
})

describe('Needs you — order', () => {
  it('puts anything blocked first, then whatever is due soonest', () => {
    const denied = night(
      { id: 'a', name: 'Denied' },
      { ...LATE, licence: 'denied', daysToDoor: 40 },
    )
    const soon = night(
      { id: 'b', name: 'Soon' },
      {
        daysToDoor: 5,
        shifts: [{ assigned: false, pencilled: false }],
      },
    )
    // Two days past its three-day target, sixty days from the door.
    const overdue = night(
      { id: 'c', name: 'Overdue' },
      {
        booking: 'enquiry',
        bookingDays: 5,
        dateTbc: true,
        daysToDoor: 60,
      },
    )
    const lastNight = night({ id: 'd', name: 'Last night' }, { daysToDoor: -1, doorCounted: true })

    const needs = needsFor([soon, lastNight, overdue, denied], as(MT), actors)
    expect(titles(needs)).toEqual([
      'Licence denied — Denied',
      'Lock the date — Overdue',
      'Close the bar — Last night',
      'Fill 1 shift — Soon',
    ])
    expect(needs.map((n) => n.when)).toEqual(['40d out', '2d over', '1d ago', '5d out'])
    expect(needs[0]).toMatchObject({
      tone: 'stop',
      sub: 'The council said no — change the bar close or the date',
    })
  })

  it("runs a booking's clock from the door when the door comes first", () => {
    const e = night({}, { booking: 'enquiry', bookingDays: 0, dateTbc: true, daysToDoor: 1 })
    expect(needsFor([e], as(MT), actors)).toMatchObject([{ when: '1d out', due: 1 }])
  })

  it('reads the night itself as tonight', () => {
    const e = night({}, { daysToDoor: 0, shifts: [{ assigned: false, pencilled: false }] })
    expect(needsFor([e], as(MT), actors).map((n) => n.when)).toContain('tonight')
  })
})

describe('Needs you — split from “nobody’s on it”', () => {
  it('keeps a null claim — a queue addressed to anyone — in "Needs you"', () => {
    // A roster gap is nobody's by name, and stays a queue anyone who can
    // open Roster is asked about — it does not become "nobody's on it".
    const shifts = [
      { assigned: true, pencilled: false },
      { assigned: false, pencilled: false },
    ]
    const e = night({}, { daysToDoor: 8, shifts })
    const needs = needsFor([e], as(AK), actors)
    expect(needs[0]!.claim).toBeNull()

    const { yours, unclaimed } = splitNeeds(needs)
    expect(yours).toEqual(needs)
    expect(unclaimed).toEqual([])
  })

  it('moves an unclaimed need out of "Needs you" and into its own pile', () => {
    // Connor: "if there's a super admin with zero of their own events, I
    // don't see why it would be saying that these things need to be done by
    // me." SL owns nothing here, and nobody who could act is named, so the
    // licence chase is Finance's to notice, not SL's to be told is theirs.
    const e = night({ ownerId: SP }, { ...LATE, licence: 'required' })
    const needs = needsFor([e], as(SL), actors)
    expect(needs[0]!.claim).toBe('unclaimed')

    const { yours, unclaimed } = splitNeeds(needs)
    expect(yours).toEqual([])
    expect(unclaimed).toEqual(needs)
  })

  it('keeps the sort order within each half', () => {
    const denied = night(
      { id: 'a', name: 'Denied', ownerId: SP },
      { ...LATE, licence: 'denied', daysToDoor: 40 },
    )
    const soon = night(
      { id: 'b', name: 'Soon', ownerId: SP },
      { ...LATE, licence: 'required', daysToDoor: 5 },
    )
    const needs = needsFor([denied, soon], as(SL), actors)
    expect(needs.every((n) => n.claim === 'unclaimed')).toBe(true)
    expect(needs.map((n) => n.title)).toEqual([
      'Licence denied — Denied',
      'Apply for the special licence — Soon',
    ])

    expect(splitNeeds(needs).unclaimed.map((n) => n.title)).toEqual(needs.map((n) => n.title))
  })
})

describe('Needs you — no cap', () => {
  it('keeps every need, however many there are', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      night(
        { id: `e${i}`, name: `Night ${i}` },
        { daysToDoor: i + 1, shifts: [{ assigned: false, pencilled: false }] },
      ),
    )
    const needs = needsFor(many, as(MT), actors)
    expect(needs).toHaveLength(9)
    expect(splitNeeds(needs).yours).toHaveLength(9)
  })
})

describe('Needs you — every gate', () => {
  it('has something to do on Home for every gate a part can hold', () => {
    const labels = new Set(
      (['enquiry', 'negotiating', 'confirmed'] as const).flatMap((booking) =>
        partsFor(input({ booking })).flatMap((p) => p.checks.map((g) => g.label)),
      ),
    )
    const missing = [...labels].filter((l) => !GATE_ACTION[l])
    expect(missing).toEqual([])
  })
})

describe('Needs you — the heading', () => {
  it('says how many things want the reader, against the size of the pipeline', () => {
    expect(homeSub(3, 11)).toBe('3 things want you today · 11 events in the pipeline')
    expect(homeSub(1, 1)).toBe('1 thing wants you today · 1 event in the pipeline')
    expect(homeSub(0, 11)).toBe('11 events in the pipeline · nothing blocking')
  })

  it('counts every open item', () => {
    expect(needsCount(0)).toBe('clear')
    expect(needsCount(9)).toBe('9 open')
  })
})

// ---------------------------------------------------------------- tiles ---

describe('the tiles', () => {
  const pipeline = [
    night({ id: 'a', ownerId: MT }, { ticketsLive: true, sold: 40 }),
    night(
      { id: 'b', ownerId: JR, riskNote: 'Artwork awaiting sign-off 6d' },
      {
        ticketsLive: true,
        sold: 12,
      },
    ),
    night({ id: 'c', ownerId: null }, { booking: 'enquiry', ticketsLive: false, sold: 0 }),
    // Put to bed: not in the pipeline any more.
    night(
      { id: 'd', ownerId: MT },
      { concluded: true, daysToDoor: -9, ticketsLive: true, sold: 99 },
    ),
  ]
  // Two nights inside the 28-day actual window (3 and 10 days ago) and one
  // well outside it (40 days ago), which must not reach the Revenue total.
  const counted = [
    { daysAgo: 3, taken: 1500 },
    { daysAgo: 40, taken: 9999 },
    { daysAgo: 10, taken: 3000 },
  ]
  // home-data.ts's own figure, handed in ready-made — homeTiles only formats it.
  const projected = 2200

  it('reads the pipeline for a viewer who can also open Finance, in order', () => {
    const tiles = homeTiles(pipeline, counted, projected, as(MT))
    expect(tiles.map((t) => [t.label, t.value, t.sub])).toEqual([
      ['In the pipeline', '3', '2 confirmed'],
      ['Next 30 days', '3', '2 confirmed'],
      ['At risk', '1', 'flagged on the pipeline'],
      ['Revenue', money(4500), `last 4 weeks · ${money(2200)} projected, next 4`],
    ])
    expect(tiles.map((t) => t.href)).toEqual([
      '/pipeline',
      '/pipeline?status=soon',
      '/pipeline?status=risk',
      null,
    ])
    expect(tiles.map((t) => t.tone)).toEqual(['plain', 'plain', 'warn', 'good'])
  })

  it('shows Revenue as the fourth tile only for a viewer who can also open Finance', () => {
    const finance = homeTiles(pipeline, counted, projected, as(MT))
    expect(finance[3]).toMatchObject({ label: 'Revenue', value: money(4500), tone: 'good' })

    // Design & comms can open the Pipeline but not Finance.
    const noFinance = homeTiles(pipeline, counted, projected, as(TW))
    expect(noFinance[3]).toMatchObject({
      label: 'On sale',
      value: '2',
      sub: '52 tickets sold',
      tone: 'plain',
      href: '/ticketing',
    })
  })

  it('stops counting a night as on sale once it has happened', () => {
    const settling = night(
      { id: 'e', ownerId: MT },
      { daysToDoor: -5, ticketsLive: true, sold: 164 },
    )
    const tiles = homeTiles([...pipeline, settling], counted, projected, as(TW))
    // Still in the pipeline until it is put to bed, but no longer selling.
    expect(tiles.find((t) => t.label === 'In the pipeline')?.value).toBe('4')
    expect(tiles.find((t) => t.label === 'On sale')).toMatchObject({
      value: '2',
      sub: '52 tickets sold',
    })
  })

  it('links On sale only for those who can open Ticketing', () => {
    const tech = homeTiles(pipeline, counted, projected, as(JR))
    expect(tech.find((t) => t.label === 'On sale')?.href).toBeNull()
  })

  it('reads nothing at risk as good news, and reads no counted night as zero revenue', () => {
    const calm = homeTiles([night()], [], 0, as(MT))
    expect(calm.find((t) => t.label === 'At risk')).toMatchObject({ value: '0', tone: 'good' })
    expect(calm.find((t) => t.label === 'Revenue')).toMatchObject({
      value: money(0),
      sub: `last 4 weeks · ${money(0)} projected, next 4`,
      tone: 'good',
    })
  })

  it('windows Next 30 days exactly as pipelineRows does — day 30 in, day 31 out', () => {
    const settling = night({ id: 'settling' }, { daysToDoor: -2 })
    const edge30 = night({ id: 'edge30' }, { daysToDoor: 30, booking: 'negotiating' })
    const edge31 = night({ id: 'edge31' }, { daysToDoor: 31 })
    const far = night({ id: 'far' }, { daysToDoor: 100, booking: 'negotiating' })

    const tiles = homeTiles([settling, edge30, edge31, far], [], 0, as(MT))
    // All four are live, two of them confirmed.
    expect(tiles[0]).toMatchObject({ label: 'In the pipeline', value: '4', sub: '2 confirmed' })
    // /pipeline?status=soon has no lower bound and includes day 30; day 31
    // drops out. Of the two left, only one is confirmed.
    expect(tiles[1]).toMatchObject({ label: 'Next 30 days', value: '2', sub: '1 confirmed' })
  })

  it('sums actual revenue over the last 28 days, ex GST — day 27 in, day 28 out', () => {
    const revCounted = [
      { daysAgo: 0, taken: 500 },
      { daysAgo: 27, taken: 300 },
      { daysAgo: 28, taken: 1_000_000 }, // a night 28 days ago: outside the window
    ]
    const tiles = homeTiles([], revCounted, 0, as(MT))
    expect(tiles.find((t) => t.label === 'Revenue')).toMatchObject({
      value: money(800),
      sub: `last 4 weeks · ${money(0)} projected, next 4`,
    })
  })

  it('reads the roster and the bar for a duty manager, who cannot open the pipeline', () => {
    const open = { assigned: false, pencilled: false }
    const nights = [
      night({ id: 'soon' }, { daysToDoor: 8, shifts: [open, open, open] }),
      // Not confirmed, but Roster crews it all the same, so its gaps count.
      night({ id: 'maybe' }, { booking: 'enquiry', daysToDoor: 12, shifts: [open, open] }),
      // Past, so a gap there is history rather than a shift to fill.
      night({ id: 'past' }, { daysToDoor: -4, shifts: [open], barClosed: false }),
      night({ id: 'older' }, { daysToDoor: -2, barClosed: false }),
      night({ id: 'closed' }, { daysToDoor: -6, barClosed: true }),
    ]

    const tiles = homeTiles(nights, counted, 0, as(AK))
    expect(tiles.map((t) => [t.label, t.value, t.sub, t.href, t.tone])).toEqual([
      ['Shifts to fill', '5', 'across 2 nights', '/roster', 'warn'],
      ['Bars to close', '2', 'oldest 4 days ago', '/bar?event=past', 'warn'],
    ])

    // Roster crews every live night, confirmed or not (16 Sep 2026), so the
    // tile that links to it counts the same nights. A past one is history.
    const pencilled = night(
      { id: 'pencilled' },
      { booking: 'negotiating', shifts: [{ assigned: false, pencilled: false }] },
    )
    const gone = night(
      { id: 'gone' },
      { booking: 'negotiating', daysToDoor: -2, shifts: [{ assigned: false, pencilled: false }] },
    )
    expect(homeTiles([pencilled, gone], [], 0, as(AK))[0]).toMatchObject({
      label: 'Shifts to fill',
      value: '1',
      sub: 'across 1 night',
      tone: 'warn',
    })

    const quiet = homeTiles([night()], [], 0, as(AK))
    expect(quiet.map((t) => [t.value, t.sub, t.tone])).toEqual([
      ['0', 'every shift filled', 'good'],
      ['0', 'every night closed', 'good'],
    ])
  })
})

describe('inRevenueWindow — which nights count toward projected revenue', () => {
  it('wants a live, confirmed night with the door 0–27 days out', () => {
    expect(inRevenueWindow(night({}, { daysToDoor: 0 }))).toBe(true)
    expect(inRevenueWindow(night({}, { daysToDoor: 27 }))).toBe(true)
    expect(inRevenueWindow(night({}, { daysToDoor: 28 }))).toBe(false)
    expect(inRevenueWindow(night({}, { daysToDoor: -1 }))).toBe(false)
  })

  it('excludes a night still being negotiated — not one to bank on', () => {
    expect(inRevenueWindow(night({}, { daysToDoor: 10, booking: 'negotiating' }))).toBe(false)
    expect(inRevenueWindow(night({}, { daysToDoor: 10, booking: 'enquiry' }))).toBe(false)
  })

  it('excludes a night already put to bed', () => {
    expect(inRevenueWindow(night({}, { daysToDoor: 10, concluded: true }))).toBe(false)
  })

  it('leaves out a night already fully counted — it is already in the actual figure', () => {
    expect(inRevenueWindow(night({}, { daysToDoor: 0, doorCounted: true, barClosed: true }))).toBe(
      false,
    )
    // A half-counted night stays in — the other half is still a projection.
    expect(inRevenueWindow(night({}, { daysToDoor: 0, doorCounted: true, barClosed: false }))).toBe(
      true,
    )
  })
})

// ------------------------------------------------------ next through the door ---

describe('Next upcoming events', () => {
  it('is up to the two soonest confirmed nights still to come, soonest first', () => {
    const events = [
      night({ id: 'enquiry' }, { booking: 'enquiry', daysToDoor: 2 }),
      night({ id: 'past' }, { daysToDoor: -3 }),
      night({ id: 'later' }, { daysToDoor: 9 }),
      night({ id: 'next' }, { daysToDoor: 5 }),
      night({ id: 'done' }, { concluded: true, daysToDoor: 1 }),
    ]
    expect(pickNext(events, 2).map((e) => e.id)).toEqual(['next', 'later'])
  })

  it('excludes an unconfirmed booking, a concluded event and a night that has passed', () => {
    const unconfirmed = night({ id: 'a' }, { booking: 'negotiating', daysToDoor: 3 })
    const concluded = night({ id: 'b' }, { concluded: true, daysToDoor: 3 })
    const past = night({ id: 'c' }, { daysToDoor: -1 })
    expect(pickNext([unconfirmed, concluded, past], 2)).toEqual([])
  })

  it('never returns more than asked for', () => {
    const events = [
      night({ id: 'a' }, { daysToDoor: 1 }),
      night({ id: 'b' }, { daysToDoor: 2 }),
      night({ id: 'c' }, { daysToDoor: 3 }),
    ]
    expect(pickNext(events, 2).map((e) => e.id)).toEqual(['a', 'b'])
    expect(pickNext(events, 1).map((e) => e.id)).toEqual(['a'])
  })

  it('reads the night for someone who can open the event record, with its surplus', () => {
    const e = night({ date: new Date(2026, 8, 25, 20, 0) }, { daysToDoor: 8 })
    expect(nextNight(e, as(MT), 1234.4)).toEqual({
      id: 'sb',
      name: 'Static Bloom',
      when: 'Fri 25 Sep · Main · DJs',
      days: '8',
      daysLabel: 'days away',
      line: `Doors 8:00pm · 40 sold of 220 · every part done · surplus to split ${money(1234.4)}`,
      href: '/events/sb',
      cta: 'Open the event',
    })
  })

  it('names what is left, and counts it once there is more than two', () => {
    const two = night({}, { daysToDoor: 1, techStatus: 'draft', assets: inReview(1) })
    expect(nextNight(two, as(MT), null)).toMatchObject({
      days: '1',
      daysLabel: 'day away',
      line: 'Doors 8:00pm · 40 sold of 220 · Design and Tech to finish',
    })

    const three = night(
      {},
      {
        techStatus: 'draft',
        assets: inReview(1),
        shifts: [{ assigned: false, pencilled: false }],
      },
    )
    expect(nextNight(three, as(MT), null).line).toBe(
      'Doors 8:00pm · 40 sold of 220 · 3 parts to finish',
    )

    const one = night({}, { techStatus: 'draft' })
    expect(nextNight(one, as(MT), null).line).toBe('Doors 8:00pm · 40 sold of 220 · Tech to finish')
  })

  it('reads the night itself as tonight', () => {
    expect(nextNight(night({}, { daysToDoor: 0 }), as(MT), null)).toMatchObject({
      days: 'Tonight',
      daysLabel: '',
    })
  })

  it('leaves the parts and the money out for a reader who cannot open the event record', () => {
    const e = night({}, { techStatus: 'draft' })
    expect(nextNight(e, as(AK), null)).toMatchObject({
      line: 'Doors 8:00pm · 40 sold of 220',
      href: '/bar?event=sb',
      cta: 'Open in Bar',
    })

    const nowhere: Viewer = { personId: null, modules: ['home', 'hours'] }
    expect(nextNight(e, nowhere, null)).toMatchObject({ href: null, cta: null })
  })

  it('reads a night with no doors time or no capacity plainly', () => {
    const e = night({}, { doors: null, capacity: 0 })
    expect(nextNight(e, as(AK), null).line).toBe('40 sold')
  })
})

// ------------------------------------------------------------ your hours ---

describe('Your hours this month', () => {
  const now = new Date(2026, 8, 17, 10, 0)
  const at = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour, 0)

  it('adds up only this month, by the day the work happened', () => {
    const mine = myHours({
      now,
      availability: null,
      employment: 'CONTRACTOR',
      entries: [
        { hours: 5, workedOn: at(7, 31, 23), rostered: true },
        { hours: 2, workedOn: at(8, 1, 0), rostered: true },
        { hours: 3.5, workedOn: at(8, 30, 23), rostered: true },
        { hours: 7, workedOn: at(9, 1, 0), rostered: true },
      ],
    })
    expect(mine.total).toBe('5.5h')
    expect(mine.cost).toBe(money(5.5 * CFG.contractorRate))
  })

  /**
   * Home shows the reader what they are paid, not what they cost the venue —
   * those only agree for an employee. Connor's 22 Sep 2026 pay policy.
   */
  it('pays a contractor and an employee at their own rate, never the loaded rate', () => {
    const entries = [{ hours: 10, workedOn: at(8, 3), rostered: true }]

    const contractor = myHours({ now, availability: null, employment: 'CONTRACTOR', entries })
    expect(contractor.cost).toBe(money(10 * CFG.contractorRate))
    expect(contractor.rate).toBe(`${money(CFG.contractorRate)}/h`)

    const employee = myHours({ now, availability: null, employment: 'EMPLOYEE', entries })
    expect(employee.cost).toBe(money(10 * CFG.rate))
    expect(employee.rate).toBe(`${money(CFG.rate)}/h`)
    // Paid at the base rate, never what the hour costs the venue loaded.
    expect(employee.cost).not.toBe(money(10 * CFG.loaded))
  })

  it('never repeats the worked total, and says only what is still ahead', () => {
    const mine = myHours({
      now,
      availability: null,
      employment: 'CONTRACTOR',
      entries: [
        { hours: 6, workedOn: at(8, 3), rostered: true },
        { hours: 2, workedOn: at(8, 17, 9), rostered: false },
        { hours: 4.5, workedOn: at(8, 25, 19), rostered: true },
      ],
    })
    // The 8h already worked are inside the 12.5h total the card leads with, so
    // this line never repeats them as "worked": it says only what is to come.
    expect(mine.split).toBe('4.5h still to come')

    expect(myHours({ now, availability: null, employment: 'CONTRACTOR', entries: [] }).split).toBe(
      'nothing logged yet',
    )

    expect(
      myHours({
        now,
        availability: null,
        employment: 'CONTRACTOR',
        entries: [{ hours: 3, workedOn: at(8, 29), rostered: true }],
      }).split,
    ).toBe('3h still to come')

    // Everything logged is already worked, nothing still ahead: the total
    // above already says it, so this line has nothing left to add.
    expect(
      myHours({
        now,
        availability: null,
        employment: 'CONTRACTOR',
        entries: [{ hours: 6, workedOn: at(8, 3), rostered: true }],
      }).split,
    ).toBe('')
  })

  it('counts typed hours as worked, whatever day they are filed under, but never says so', () => {
    // Org-wide hours are filed under the 15th of their month, so that a
    // timezone cannot roll them into a neighbour. Typed on the 3rd, that is a
    // day still to come, but only a rostered shift is work not yet done.
    const early = new Date(2026, 8, 3, 10, 0)
    const mine = myHours({
      now: early,
      availability: null,
      employment: 'CONTRACTOR',
      entries: [
        { hours: 4, workedOn: at(8, 15, 0), rostered: false },
        { hours: 6, workedOn: at(8, 20), rostered: true },
      ],
    })
    expect(mine.total).toBe('10h')
    expect(mine.split).toBe('6h still to come')
  })

  it('measures them against what the person is available for this month', () => {
    // Eleven a week over September's thirty days is about 47 hours.
    const mine = myHours({
      now,
      availability: { weekly: 11, volunteer: 0 },
      employment: 'CONTRACTOR',
      entries: [{ hours: 12, workedOn: at(8, 3), rostered: true }],
    })
    expect(mine.pct).toBe(25)
    expect(mine.capLabel).toBe('of the ~47h you’re available this month')

    // Volunteer hours are headroom on top, as the roster counts them.
    const keen = myHours({
      now,
      availability: { weekly: 11, volunteer: 3.5 },
      employment: 'CONTRACTOR',
      entries: [{ hours: 12, workedOn: at(8, 3), rostered: true }],
    })
    expect(keen.capLabel).toBe('of the ~62h you’re available this month')
  })

  it('fills the bar and no further', () => {
    const over = myHours({
      now,
      availability: { weekly: 2, volunteer: 0 },
      employment: 'CONTRACTOR',
      entries: [{ hours: 40, workedOn: at(8, 3), rostered: true }],
    })
    expect(over.pct).toBe(100)
  })

  it('draws no bar for someone who has said nothing about their hours', () => {
    for (const availability of [null, { weekly: 0, volunteer: 0 }]) {
      const mine = myHours({
        now,
        availability,
        employment: 'CONTRACTOR',
        entries: [{ hours: 3, workedOn: at(8, 3), rostered: true }],
      })
      expect(mine.pct).toBeNull()
      expect(mine.capLabel).toBeNull()
    }
  })
})

// ------------------------------------------------------- around the page ---

describe('the greeting', () => {
  it('uses the first name', () => {
    expect(greeting('Mere Tapu')).toBe('Kia ora, Mere.')
    expect(greeting('Sione')).toBe('Kia ora, Sione.')
    expect(greeting('  ')).toBe('Kia ora.')
  })
})

describe('who Home is for', () => {
  it('refuses an outside account, whatever the permission matrix says', () => {
    expect(homeRefusal({ external: true })).toMatch(/Sign-offs/)
    expect(homeRefusal({ external: false })).toBeNull()
  })

  it('lands the venue on Home, and an outside promoter on their events', () => {
    const coordinator = [...DEFAULT_PERMS.coordinator].reverse()
    expect(landingFor(coordinator, false)).toBe('/home')
    expect(landingFor(DEFAULT_PERMS.bar, false)).toBe('/home')
    expect(landingFor(DEFAULT_PERMS.promoter, true)).toBe('/pipeline')
    // Home granted to promoters in Admin still does not land them on it.
    expect(landingFor(['home', ...DEFAULT_PERMS.promoter], true)).toBe('/pipeline')
  })

  it('falls back to the first built module in sidebar order', () => {
    const noHome: ModuleKey[] = ['hours', 'bar', 'roster']
    expect(landingFor(noHome, false)).toBe('/roster')
    expect(landingFor(['portal'], true)).toBe('/portal')
    expect(landingFor(['admin'], false)).toBe('/admin')
    expect(landingFor([], false)).toBeNull()
  })
})
