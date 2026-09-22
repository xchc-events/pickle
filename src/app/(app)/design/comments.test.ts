import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

/**
 * D5 — posting to a design comment thread from Design itself.
 *
 * `postComment`'s own behaviour (upserting the asset row, trimming, the
 * activity line) is proven once in comments-data.test.ts; this proves
 * `postDesignComment` checks Design's own module and event scope first.
 */

vi.mock('server-only', () => ({}))

vi.mock('@/lib/permissions', () => ({
  requireModule: vi.fn(async () => ({ user: tui, modules: ['design'] })),
  requireEvent: vi.fn(async (_: unknown, id: string) => id),
}))

vi.mock('@/lib/files-data', () => ({}))

const assetUpsert = vi.fn()
const commentCreate = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    asset: { upsert: (...a: unknown[]) => assetUpsert(...a) },
    comment: { create: (...a: unknown[]) => commentCreate(...a) },
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

const { postDesignComment } = await import('./actions')

const EVENT = 'evt_static_bloom'

beforeEach(() => {
  vi.clearAllMocks()
  assetUpsert.mockResolvedValue({ id: 'asset_cover' })
  commentCreate.mockResolvedValue({})
})

describe('postDesignComment', () => {
  it('posts under a piece', async () => {
    const out = await postDesignComment(EVENT, 'cover', 'looks great')
    expect(out.kind).not.toBe('stop')
    expect(commentCreate).toHaveBeenCalledWith({
      data: {
        eventId: EVENT,
        assetId: 'asset_cover',
        authorId: tui.id,
        who: tui.initials,
        body: 'looks great',
      },
    })
  })

  it('posts to the general thread when there is no piece', async () => {
    await postDesignComment(EVENT, null, 'general note')
    expect(assetUpsert).not.toHaveBeenCalled()
    expect(commentCreate).toHaveBeenCalledWith({
      data: { eventId: EVENT, assetId: null, authorId: tui.id, who: tui.initials, body: 'general note' },
    })
  })

  it('refuses an empty comment', async () => {
    const out = await postDesignComment(EVENT, 'cover', '   ')
    expect(out.kind).toBe('stop')
    expect(commentCreate).not.toHaveBeenCalled()
  })

  it('is also an activity line', async () => {
    await postDesignComment(EVENT, 'cover', 'looks great')
    expect(record).toHaveBeenCalledOnce()
  })
})
