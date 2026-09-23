import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from './session'

/**
 * D5/D6 — what an external promoter sees on their portal: which events
 * (unchanged, but reproven here now the query carries more), which pieces
 * of each one's set, and which comment thread belongs to which.
 *
 * Same shape of test as design-data.test.ts — the fake `db.event.findMany`
 * applies the real `where` clause rather than being told what to return, so
 * a scope bug shows up the same way it would in production: another
 * organisation's row simply is not there.
 */

vi.mock('server-only', () => ({}))

interface FakeAsset {
  id: string
  key: string
  state: string
}

interface FakeEvent {
  id: string
  name: string
  date: Date
  promoterId: string | null
  concluded: boolean
  bookingStatus: string
  assets: FakeAsset[]
  packIn?: string | null
  doors?: string | null
  barClose?: string | null
  allOut?: string | null
  packOut?: string | null
}

let events: FakeEvent[] = []
let files: { id: string; name: string; version: number; assetId: string }[] = []
let comments: {
  id: string
  eventId: string
  assetId: string | null
  who: string
  body: string
  at: Date
}[] = []
let runSheetSends: { eventId: string }[] = []
let runSheetItems: {
  id: string
  eventId: string
  time: string | null
  item: string
  who: string | null
  note: string | null
  order: number
}[] = []

const matches = (event: FakeEvent, where: Record<string, unknown> | undefined): boolean => {
  if (!where) return true
  if ('AND' in where)
    return (where.AND as Record<string, unknown>[]).every((w) => matches(event, w))
  return Object.entries(where).every(([key, want]) => {
    const have = (event as unknown as Record<string, unknown>)[key]
    if (want && typeof want === 'object' && 'in' in (want as object)) {
      return (want as { in: unknown[] }).in.includes(have)
    }
    return have === want
  })
}

const applyAssetWhere = (assets: FakeAsset[], where: Record<string, unknown> | undefined) => {
  if (!where) return assets
  return assets.filter((a) => {
    return Object.entries(where).every(([key, want]) => {
      const have = (a as unknown as Record<string, unknown>)[key]
      if (want && typeof want === 'object' && 'not' in (want as object)) {
        return have !== (want as { not: unknown }).not
      }
      return have === want
    })
  })
}

const db = {
  event: {
    findMany: vi.fn(
      (args: {
        where: Record<string, unknown>
        select: { assets?: { where?: Record<string, unknown> } }
      }) =>
        Promise.resolve(
          events
            .filter((e) => matches(e, args.where))
            .map((e) => ({ ...e, assets: applyAssetWhere(e.assets, args.select.assets?.where) })),
        ),
    ),
  },
  payee: { findFirst: vi.fn().mockResolvedValue(null) },
  storedFile: {
    findMany: vi.fn((args: { where: { assetId: { in: string[] } } }) =>
      Promise.resolve(files.filter((f) => args.where.assetId.in.includes(f.assetId))),
    ),
  },
  comment: {
    findMany: vi.fn((args: { where: { eventId: string } }) =>
      Promise.resolve(comments.filter((c) => c.eventId === args.where.eventId)),
    ),
  },
  runSheetSend: {
    findFirst: vi.fn((args: { where: { eventId: string } }) =>
      Promise.resolve(runSheetSends.find((s) => s.eventId === args.where.eventId) ?? null),
    ),
  },
  runSheetItem: {
    findMany: vi.fn((args: { where: { eventId: string } }) =>
      Promise.resolve(
        runSheetItems
          .filter((r) => r.eventId === args.where.eventId)
          .sort((a, b) => a.order - b.order),
      ),
    ),
  },
}
vi.mock('./db', () => ({ db }))

const { loadPortal } = await import('./portal-data')

const orgAUser: SessionUser = {
  id: 'u_promoter_a',
  email: 'aroha@koura.example',
  name: 'Aroha',
  role: 'PROMOTER',
  roleKey: 'promoter',
  organisationId: 'org_a',
  organisationName: 'Kōura Collective',
  external: true,
  personId: null,
  initials: 'AR',
  authenticated: true,
  sessionId: 's1',
}

beforeEach(() => {
  db.event.findMany.mockClear()
  files = []
  comments = []
  runSheetSends = []
  runSheetItems = []
  events = [
    {
      id: 'ev_a',
      name: 'Kōura Night',
      date: new Date('2026-10-10'),
      promoterId: 'org_a',
      concluded: false,
      bookingStatus: 'CONFIRMED',
      assets: [
        { id: 'asset_cover', key: 'cover', state: 'REVIEW' },
        { id: 'asset_listing', key: 'listing', state: 'APPROVED' },
        { id: 'asset_poster', key: 'poster', state: 'DRAFT' },
      ],
    },
    {
      id: 'ev_b',
      name: 'Aro Night',
      date: new Date('2026-10-12'),
      promoterId: 'org_b',
      concluded: false,
      bookingStatus: 'CONFIRMED',
      assets: [{ id: 'asset_b_cover', key: 'cover', state: 'REVIEW' }],
    },
  ]
})

describe('which events a promoter sees', () => {
  it('never receives another organisation’s event', async () => {
    const { events: rows } = await loadPortal(orgAUser)
    expect(rows.map((e) => e.id)).toEqual(['ev_a'])
  })

  it('sends the scope to the database rather than filtering afterwards', async () => {
    await loadPortal(orgAUser)
    const [{ where }] = db.event.findMany.mock.calls.at(-1)!
    expect(where).toMatchObject({ AND: expect.arrayContaining([{ promoterId: 'org_a' }]) })
  })
})

describe('the pieces on an event', () => {
  it('lists a piece in review and a piece signed off, but not a draft', async () => {
    const { events: rows } = await loadPortal(orgAUser)
    const keys = rows[0]!.pieces.map((p) => p.key)
    expect(keys).toEqual(expect.arrayContaining(['cover', 'listing']))
    expect(keys).not.toContain('poster')
  })

  it('carries the piece’s state, lowercased', async () => {
    const { events: rows } = await loadPortal(orgAUser)
    const cover = rows[0]!.pieces.find((p) => p.key === 'cover')
    const listing = rows[0]!.pieces.find((p) => p.key === 'listing')
    expect(cover?.state).toBe('review')
    expect(listing?.state).toBe('approved')
  })

  it('counts only what is in review as waiting on the promoter', async () => {
    const { events: rows } = await loadPortal(orgAUser)
    expect(rows[0]!.awaitingSignOff).toBe(1)
  })

  it('attaches the current artwork file to its piece', async () => {
    files = [{ id: 'file_1', name: 'cover.png', version: 2, assetId: 'asset_cover' }]
    const { events: rows } = await loadPortal(orgAUser)
    const cover = rows[0]!.pieces.find((p) => p.key === 'cover')
    expect(cover?.file).toEqual({ id: 'file_1', name: 'cover.png', version: 2 })
    expect(rows[0]!.pieces.find((p) => p.key === 'listing')?.file).toBeNull()
  })
})

describe('comment threads', () => {
  it('splits a piece’s own thread from the event’s general one', async () => {
    comments = [
      {
        id: 'c1',
        eventId: 'ev_a',
        assetId: 'asset_cover',
        who: 'TW',
        body: 'on the cover',
        at: new Date(),
      },
      { id: 'c2', eventId: 'ev_a', assetId: null, who: 'AR', body: 'general note', at: new Date() },
      // Another organisation's thread — proves it never crosses over even
      // though both events' comment rows are fetched from the same table.
      { id: 'c3', eventId: 'ev_b', assetId: null, who: 'RK', body: 'not yours', at: new Date() },
    ]
    const { events: rows } = await loadPortal(orgAUser)
    expect(rows[0]!.generalComments.map((c) => c.body)).toEqual(['general note'])
    expect(rows[0]!.pieces.find((p) => p.key === 'cover')?.comments.map((c) => c.body)).toEqual([
      'on the cover',
    ])
  })

  it('never reads another organisation’s comments at all — the event itself is out of scope', async () => {
    comments = [
      { id: 'c3', eventId: 'ev_b', assetId: null, who: 'RK', body: 'not yours', at: new Date() },
    ]
    await loadPortal(orgAUser)
    // ev_b was never in the scoped result, so its comments were never
    // fetched — not merely filtered out afterwards.
    expect(db.comment.findMany).not.toHaveBeenCalledWith({ where: { eventId: 'ev_b' } })
  })
})

/**
 * X3 — the run sheet, read-only.
 *
 * Connor, 23 Sep 2026: "sending that to the promoter" is what makes a run
 * sheet theirs to see at all — nothing is shown before Tech has sent one.
 */
describe('the run sheet', () => {
  it('is null until Tech has sent one', async () => {
    const { events: rows } = await loadPortal(orgAUser)
    expect(rows[0]!.runSheet).toBeNull()
  })

  it('reads the event’s rows, in order, once something has been sent', async () => {
    runSheetSends = [{ eventId: 'ev_a' }]
    runSheetItems = [
      { id: 'r1', eventId: 'ev_a', time: '8:00pm', item: 'Doors', who: null, note: null, order: 1 },
      {
        id: 'r2',
        eventId: 'ev_a',
        time: '3:00pm',
        item: 'Pack-in',
        who: 'Crew',
        note: null,
        order: 0,
      },
    ]

    const { events: rows } = await loadPortal(orgAUser)

    expect(rows[0]!.runSheet?.map((r) => r.item)).toEqual(['Pack-in', 'Doors'])
  })

  it('never reads another organisation’s run sheet — ev_b is out of scope before this even runs', async () => {
    runSheetSends = [{ eventId: 'ev_b' }]
    const { events: rows } = await loadPortal(orgAUser)
    expect(rows[0]!.runSheet).toBeNull()
  })
})
