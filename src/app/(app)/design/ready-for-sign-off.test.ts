import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

/**
 * D6 — design staff's half of sign-off: putting a piece up for review.
 * They no longer decide whether a piece is right (see approve-asset.test.ts
 * for that half); this is the one thing they still do themselves.
 */

vi.mock('server-only', () => ({}))

vi.mock('@/lib/permissions', () => ({
  requireModule: vi.fn(async () => ({ user: tui, modules: ['design'] })),
  requireEvent: vi.fn(async (_: unknown, id: string) => id),
}))

vi.mock('@/lib/files-data', () => ({}))

const assetFindUnique = vi.fn()
const assetUpsert = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    asset: {
      findUnique: (...a: unknown[]) => assetFindUnique(...a),
      upsert: (...a: unknown[]) => assetUpsert(...a),
    },
  },
}))

const record = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...a: unknown[]) => record(...a) }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))

const tui: SessionUser = {
  id: 'user_tui',
  email: 'tui@xchc.test',
  name: 'Tui Ware',
  role: 'DESIGN',
  roleKey: 'design',
  organisationId: null,
  organisationName: null,
  external: false,
  personId: 'person_tui',
  initials: 'TW',
  authenticated: true,
  sessionId: 'session_tui',
}

const { readyForSignOff } = await import('./actions')

const EVENT = 'evt_static_bloom'

beforeEach(() => {
  vi.clearAllMocks()
  assetFindUnique.mockResolvedValue(null)
  assetUpsert.mockResolvedValue({})
})

describe('readyForSignOff', () => {
  it('refuses a piece that is not in the set', async () => {
    const out = await readyForSignOff(EVENT, 'not-a-key')
    expect(out.kind).toBe('stop')
    expect(assetUpsert).not.toHaveBeenCalled()
  })

  it('creates the row at REVIEW when there is not one yet', async () => {
    await readyForSignOff(EVENT, 'cover')
    expect(assetUpsert).toHaveBeenCalledWith({
      where: { eventId_key: { eventId: EVENT, key: 'cover' } },
      create: { eventId: EVENT, key: 'cover', state: 'REVIEW' },
      update: { state: 'REVIEW' },
    })
  })

  it('moves a draft row to review', async () => {
    assetFindUnique.mockResolvedValue({ state: 'DRAFT' })
    const out = await readyForSignOff(EVENT, 'cover')
    expect(out.kind).not.toBe('stop')
    expect(assetUpsert).toHaveBeenCalled()
  })

  it('refuses a piece already up for review', async () => {
    assetFindUnique.mockResolvedValue({ state: 'REVIEW' })
    const out = await readyForSignOff(EVENT, 'cover')
    expect(out.kind).toBe('stop')
    expect(assetUpsert).not.toHaveBeenCalled()
  })

  it('refuses a piece that is already signed off', async () => {
    assetFindUnique.mockResolvedValue({ state: 'APPROVED' })
    const out = await readyForSignOff(EVENT, 'cover')
    expect(out.kind).toBe('stop')
    expect(assetUpsert).not.toHaveBeenCalled()
  })

  it('records an activity line naming the piece', async () => {
    await readyForSignOff(EVENT, 'cover')
    expect(record).toHaveBeenCalledOnce()
    expect(record.mock.calls[0]![2]).toContain('Facebook / event cover')
  })
})
