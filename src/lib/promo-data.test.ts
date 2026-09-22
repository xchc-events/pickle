import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from './session'

/**
 * Whether an external promoter can read another organisation's contact
 * details through the Promo lead panel.
 *
 * `loadPromo` scopes its one query with `eventScope`, the same function every
 * other module uses — this file does not re-test `eventScope` itself (see
 * scope.test.ts), it tests that promo-data.ts actually sends it to the
 * database rather than filtering afterwards. The fake `db.event.findMany`
 * below applies the real `where` clause to an in-memory table, so a query
 * that forgot the scope, or scoped the wrong field, fails here the way a
 * missing `WHERE` would fail against Postgres.
 */

vi.mock('server-only', () => ({}))

interface FakeLead {
  role: string
  person: { name: string; user: { email: string; phone: string | null } | null }
}

interface FakeEvent {
  id: string
  name: string
  date: Date
  promoterId: string | null
  concluded: boolean
  space: { name: string }
  channels: never[]
  beats: never[]
  leads: FakeLead[]
  brief: string | null
  format: string
  std: number
  door: number
}

let events: FakeEvent[] = []

/** Prisma's `where`, for the shapes eventScope() and promo-data.ts produce. */
const matches = (event: FakeEvent, where: Record<string, unknown> | undefined): boolean => {
  if (!where) return true
  if ('AND' in where) return (where.AND as Record<string, unknown>[]).every((w) => matches(event, w))
  return Object.entries(where).every(([key, want]) => {
    const have = (event as unknown as Record<string, unknown>)[key]
    if (want && typeof want === 'object' && 'in' in (want as object)) {
      return (want as { in: unknown[] }).in.includes(have)
    }
    return have === want
  })
}

const db = {
  event: {
    findMany: vi.fn((args: { where: Record<string, unknown> }) =>
      Promise.resolve(events.filter((e) => matches(e, args.where))),
    ),
  },
}
vi.mock('./db', () => ({ db }))

const { loadPromo } = await import('./promo-data')

const lead = (name: string, email: string, phone: string | null): FakeLead => ({
  role: 'PROMO',
  person: { name, user: { email, phone } },
})

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
  events = [
    {
      id: 'ev_a',
      name: 'Kōura Night',
      date: new Date('2026-10-10'),
      promoterId: 'org_a',
      concluded: false,
      space: { name: 'Main' },
      channels: [],
      beats: [],
      leads: [lead('Tui Ware', 'tui@xchc.co.nz', '021 555 0100')],
      brief: null,
      format: 'DJs',
      std: 30,
      door: 40,
    },
    {
      id: 'ev_b',
      name: 'Aro Night',
      date: new Date('2026-10-12'),
      promoterId: 'org_b',
      concluded: false,
      space: { name: 'Main' },
      channels: [],
      beats: [],
      leads: [lead('Reube Katene', 'reube@xchc.co.nz', '021 555 0200')],
      brief: null,
      format: 'DJs',
      std: 30,
      door: 40,
    },
  ]
})

describe('an external promoter, reading the Promo lead panel', () => {
  it('sees their own event’s lead contact fields', async () => {
    const { event } = await loadPromo(orgAUser, 'ev_a')
    expect(event?.id).toBe('ev_a')
    expect(event?.leadName).toBe('Tui Ware')
    expect(event?.leadEmail).toBe('tui@xchc.co.nz')
    expect(event?.leadPhone).toBe('021 555 0100')
  })

  it('never receives another organisation’s event, even by asking for its id', async () => {
    const { event, queue } = await loadPromo(orgAUser, 'ev_b')

    // eventScope excludes ev_b before it reaches this file, so asking for it
    // by id falls back to the promoter's own event — the query is scoped,
    // not the display. Org B's lead details are never in reach.
    expect(event?.id).toBe('ev_a')
    expect(event?.leadEmail).not.toBe('reube@xchc.co.nz')
    expect(queue.map((q) => q.id)).toEqual(['ev_a'])
  })

  it('sees nothing at all once none of the fixture events belong to them', async () => {
    events = events.filter((e) => e.promoterId !== 'org_a')
    const { event, queue } = await loadPromo(orgAUser, 'ev_a')
    expect(event).toBeNull()
    expect(queue).toEqual([])
  })

  it('sends the scope to the database rather than filtering afterwards', async () => {
    await loadPromo(orgAUser, 'ev_a')
    const [{ where }] = db.event.findMany.mock.calls.at(-1)!
    expect(where).toMatchObject({ AND: expect.arrayContaining([{ promoterId: 'org_a' }]) })
  })
})

describe('staff, reading the same panel', () => {
  it('are not scoped to one organisation', async () => {
    const staff: SessionUser = { ...orgAUser, role: 'COORDINATOR', external: false, organisationId: null }
    const { event, queue } = await loadPromo(staff, 'ev_b')
    expect(event?.id).toBe('ev_b')
    expect(event?.leadEmail).toBe('reube@xchc.co.nz')
    expect(queue.map((q) => q.id).sort()).toEqual(['ev_a', 'ev_b'])
  })
})
