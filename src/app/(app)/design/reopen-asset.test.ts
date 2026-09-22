import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

/**
 * D3 — reopening a signed-off piece from Design.
 *
 * The permission and the state change are proven once in
 * design-signoff.test.ts; this proves `reopenPiece` checks Design's own
 * module and event scope and then reaches that shared core.
 */

vi.mock('server-only', () => ({}))

// The mocked `requireModule` ignores which module was asked for — every
// test here names its own `user` through `.mockResolvedValue`, never the
// module key — so the wrapper below takes no arguments either.
const requireModule = vi.fn(
  async (): Promise<{ user: SessionUser; modules: string[] }> => ({
    user: owner,
    modules: ['design'],
  }),
)
vi.mock('@/lib/permissions', () => ({
  requireModule: () => requireModule(),
  requireEvent: vi.fn(async (_: unknown, id: string) => id),
}))

vi.mock('@/lib/files-data', () => ({}))

const assetUpdateMany = vi.fn()
const eventFindUnique = vi.fn()
const commentCreate = vi.fn()
const assetUpsert = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    asset: {
      updateMany: (...a: unknown[]) => assetUpdateMany(...a),
      upsert: (...a: unknown[]) => assetUpsert(...a),
    },
    event: { findUnique: (...a: unknown[]) => eventFindUnique(...a) },
    comment: { create: (...a: unknown[]) => commentCreate(...a) },
  },
}))

const record = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...a: unknown[]) => record(...a) }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))

const owner: SessionUser = {
  id: 'user_owner',
  email: 'owner@xchc.test',
  name: 'The Owner',
  role: 'COORDINATOR',
  roleKey: 'coordinator',
  organisationId: null,
  organisationName: null,
  external: false,
  personId: 'person_owner',
  initials: 'AO',
  authenticated: true,
  sessionId: 'session_owner',
}
const designStaff: SessionUser = {
  ...owner,
  id: 'user_tui',
  role: 'DESIGN',
  roleKey: 'design',
  personId: 'person_tui',
  initials: 'TW',
}

const { reopenPiece } = await import('./actions')

const EVENT = 'evt_static_bloom'

beforeEach(() => {
  vi.clearAllMocks()
  requireModule.mockResolvedValue({ user: owner, modules: ['design'] })
  eventFindUnique.mockResolvedValue({ ownerId: owner.personId, promoterId: null })
  assetUpdateMany.mockResolvedValue({ count: 1 })
  assetUpsert.mockResolvedValue({ id: 'asset_1' })
  commentCreate.mockResolvedValue({})
})

describe('reopenPiece', () => {
  it('refuses design staff, who may not sign off', async () => {
    requireModule.mockResolvedValue({ user: designStaff, modules: ['design'] })
    const out = await reopenPiece(EVENT, 'cover', 'wrong price on it')
    expect(out.kind).toBe('stop')
    expect(assetUpdateMany).not.toHaveBeenCalled()
  })

  it('refuses an empty reason', async () => {
    const out = await reopenPiece(EVENT, 'cover', '  ')
    expect(out.kind).toBe('stop')
    expect(assetUpdateMany).not.toHaveBeenCalled()
  })

  it('moves an approved piece back to review, clears its signature, and comments why', async () => {
    const out = await reopenPiece(EVENT, 'cover', 'wrong price on it')
    expect(out.kind).not.toBe('stop')
    expect(assetUpdateMany).toHaveBeenCalledWith({
      where: { eventId: EVENT, key: 'cover', state: 'APPROVED' },
      data: { state: 'REVIEW', signedById: null, signedAt: null, promoterSigned: false },
    })
    expect(commentCreate).toHaveBeenCalledWith({
      data: {
        eventId: EVENT,
        assetId: 'asset_1',
        authorId: owner.id,
        who: owner.initials,
        body: 'wrong price on it',
      },
    })
  })

  it('says there is nothing to reopen when the piece was never signed off', async () => {
    assetUpdateMany.mockResolvedValue({ count: 0 })
    const out = await reopenPiece(EVENT, 'cover', 'wrong price on it')
    expect(out.kind).toBe('stop')
    expect(commentCreate).not.toHaveBeenCalled()
  })
})
