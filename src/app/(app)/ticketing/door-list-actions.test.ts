import { beforeEach, describe, expect, it, vi } from 'vitest'
import { said } from '@/lib/toast'

/**
 * `addDoorListEntry` and `removeDoorListEntry` — T7. Venue only, the same
 * refusal as Codes: this is the venue's own operational list for the door,
 * not something an external promoter edits. `db`, `permissions` and
 * `activity` are mocked so this runs with no database.
 */

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  record: vi.fn(),
  refresh: vi.fn(),
  requireModule: vi.fn(),
  requireEvent: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    doorListEntry: {
      findFirst: mocks.findFirst,
      create: mocks.create,
      delete: mocks.delete,
    },
  },
}))
vi.mock('@/lib/activity', () => ({ record: mocks.record }))
vi.mock('@/lib/permissions', () => ({
  requireModule: mocks.requireModule,
  requireEvent: mocks.requireEvent,
}))
vi.mock('next/cache', () => ({ refresh: mocks.refresh }))

const { addDoorListEntry, removeDoorListEntry } = await import('./door-list-actions')

const EVENT_ID = 'evt_1'
const INTERNAL_USER = { id: 'user_1', name: 'Mere Tapu', external: false } as never
const EXTERNAL_USER = { id: 'user_2', name: 'Awhina Reid', external: true } as never

function entryForm(fields: Partial<Record<'name' | 'partySize' | 'kind' | 'note', string>>) {
  const form = new FormData()
  const defaults = { name: 'Ari Tāne', partySize: '2', kind: 'GUEST' }
  for (const [k, v] of Object.entries({ ...defaults, ...fields })) form.set(k, v)
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireModule.mockResolvedValue({ user: INTERNAL_USER })
  mocks.requireEvent.mockResolvedValue(EVENT_ID)
})

describe('addDoorListEntry', () => {
  it('refuses an external account before touching the database', async () => {
    mocks.requireModule.mockResolvedValue({ user: EXTERNAL_USER })
    const result = await addDoorListEntry(EVENT_ID, entryForm({}))
    expect(result).toEqual(said('Not something an external account can do.', 'stop'))
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('refuses a blank name and does not touch the database', async () => {
    const result = await addDoorListEntry(EVENT_ID, entryForm({ name: '   ' }))
    expect(result.kind).toBe('stop')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('refuses a party size under 1', async () => {
    const result = await addDoorListEntry(EVENT_ID, entryForm({ partySize: '0' }))
    expect(result.kind).toBe('stop')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('adds a comp entry with its party size and logs it', async () => {
    const result = await addDoorListEntry(
      EVENT_ID,
      entryForm({ kind: 'COMP', partySize: '3', note: 'artist guest list' }),
    )
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        eventId: EVENT_ID,
        name: 'Ari Tāne',
        partySize: 3,
        kind: 'COMP',
        note: 'artist guest list',
        addedById: 'user_1',
        who: 'Mere Tapu',
      },
    })
    expect(mocks.record).toHaveBeenCalledWith(
      EVENT_ID,
      INTERNAL_USER,
      expect.stringMatching(/Ari Tāne/),
    )
    expect(mocks.refresh).toHaveBeenCalled()
    expect(result.kind).toBe('good')
  })

  it('stores a blank note as null', async () => {
    await addDoorListEntry(EVENT_ID, entryForm({ note: '  ' }))
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note: null }),
    })
  })

  it('scopes the event through requireEvent before touching it', async () => {
    await addDoorListEntry(EVENT_ID, entryForm({}))
    expect(mocks.requireModule).toHaveBeenCalledWith('ticketing')
    expect(mocks.requireEvent).toHaveBeenCalledWith(INTERNAL_USER, EVENT_ID)
  })
})

describe('removeDoorListEntry', () => {
  it('refuses an external account before touching the database', async () => {
    mocks.requireModule.mockResolvedValue({ user: EXTERNAL_USER })
    const result = await removeDoorListEntry(EVENT_ID, 'entry_1')
    expect(result).toEqual(said('Not something an external account can do.', 'stop'))
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('refuses an entry that is not on this event', async () => {
    mocks.findFirst.mockResolvedValue(null)
    const result = await removeDoorListEntry(EVENT_ID, 'entry_1')
    expect(result.kind).toBe('stop')
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('removes an entry and logs it', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'entry_1',
      name: 'Ari Tāne',
      kind: 'COMP',
      partySize: 3,
    })
    const result = await removeDoorListEntry(EVENT_ID, 'entry_1')
    expect(mocks.delete).toHaveBeenCalledWith({ where: { id: 'entry_1' } })
    expect(mocks.record).toHaveBeenCalledWith(
      EVENT_ID,
      INTERNAL_USER,
      expect.stringMatching(/Ari Tāne/),
    )
    expect(mocks.refresh).toHaveBeenCalled()
    expect(result.kind).toBe('good')
  })
})
