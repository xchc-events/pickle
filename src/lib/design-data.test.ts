import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from './session'

/**
 * Whether an external promoter can read another organisation's contact
 * details through the Design lead card. Same shape of test as
 * promo-data.test.ts — see the note there for why the fake `db.event.findMany`
 * applies the real `where` clause rather than being told what to return.
 */

vi.mock('server-only', () => ({}))

interface FakeLead {
  role: string
  personId: string
  person: { name: string; initials: string; user: { email: string; phone: string | null } | null }
}

interface FakeEvent {
  id: string
  name: string
  date: Date
  promoter: string | null
  promoterId: string | null
  concluded: boolean
  space: { name: string }
  format: string
  std: number
  door: number
  brief: string | null
  assets: never[]
  tasks: never[]
  files: never[]
  artists: never[]
  leads: FakeLead[]
}

let events: FakeEvent[] = []

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

const db = {
  event: {
    findMany: vi.fn((args: { where: Record<string, unknown> }) =>
      Promise.resolve(events.filter((e) => matches(e, args.where))),
    ),
  },
  user: { findMany: vi.fn().mockResolvedValue([]) },
  storedFile: { findMany: vi.fn().mockResolvedValue([]) },
  hourEntry: { findMany: vi.fn().mockResolvedValue([]) },
}
vi.mock('./db', () => ({ db }))

const { loadDesign } = await import('./design-data')

const lead = (name: string, email: string, phone: string | null): FakeLead => ({
  role: 'DESIGN',
  personId: `person_${name}`,
  person: { name, initials: name.slice(0, 2).toUpperCase(), user: { email, phone } },
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
      promoter: 'Kōura Collective',
      promoterId: 'org_a',
      concluded: false,
      space: { name: 'Main' },
      format: 'DJs',
      std: 30,
      door: 40,
      brief: null,
      assets: [],
      tasks: [],
      files: [],
      artists: [],
      leads: [lead('Tui Ware', 'tui@xchc.co.nz', '021 555 0100')],
    },
    {
      id: 'ev_b',
      name: 'Aro Night',
      date: new Date('2026-10-12'),
      promoter: 'Aro Label',
      promoterId: 'org_b',
      concluded: false,
      space: { name: 'Main' },
      format: 'DJs',
      std: 30,
      door: 40,
      brief: null,
      assets: [],
      tasks: [],
      files: [],
      artists: [],
      leads: [lead('Reube Katene', 'reube@xchc.co.nz', '021 555 0200')],
    },
  ]
})

describe('an external promoter, reading the Design lead card', () => {
  it('sees their own event’s design lead contact fields', async () => {
    const { event } = await loadDesign(orgAUser, 'ev_a', true)
    expect(event?.id).toBe('ev_a')
    expect(event?.leadName).toBe('Tui Ware')
    expect(event?.leadEmail).toBe('tui@xchc.co.nz')
    expect(event?.leadPhone).toBe('021 555 0100')
  })

  it('never receives another organisation’s event, even by asking for its id', async () => {
    const { event, queue } = await loadDesign(orgAUser, 'ev_b', true)

    expect(event?.id).toBe('ev_a')
    expect(event?.leadEmail).not.toBe('reube@xchc.co.nz')
    expect(queue.map((q) => q.id)).toEqual(['ev_a'])
  })

  it('sends the scope to the database rather than filtering afterwards', async () => {
    await loadDesign(orgAUser, 'ev_a', true)
    const [{ where }] = db.event.findMany.mock.calls.at(-1)!
    expect(where).toMatchObject({ AND: expect.arrayContaining([{ promoterId: 'org_a' }]) })
  })
})

describe('staff, reading the same card', () => {
  it('are not scoped to one organisation', async () => {
    const staff: SessionUser = {
      ...orgAUser,
      role: 'COORDINATOR',
      external: false,
      organisationId: null,
    }
    const { event, queue } = await loadDesign(staff, 'ev_b', true)
    expect(event?.id).toBe('ev_b')
    expect(event?.leadEmail).toBe('reube@xchc.co.nz')
    expect(queue.map((q) => q.id).sort()).toEqual(['ev_a', 'ev_b'])
  })
})
