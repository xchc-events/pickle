import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from './session'

/**
 * D5 — the design comment thread.
 *
 * Shared by Design and the promoter portal: each surface checks its own
 * module and event scope, then calls straight into this. `postComment` is
 * the one place a comment is created, so "every comment is also an activity
 * line" cannot go true on one surface and false on the other.
 */

vi.mock('server-only', () => ({}))

const assetUpsert = vi.fn()
const commentCreate = vi.fn()
const commentFindMany = vi.fn()
vi.mock('./db', () => ({
  db: {
    asset: { upsert: (...a: unknown[]) => assetUpsert(...a) },
    comment: {
      create: (...a: unknown[]) => commentCreate(...a),
      findMany: (...a: unknown[]) => commentFindMany(...a),
    },
  },
}))

const record = vi.fn()
vi.mock('./activity', () => ({ record: (...a: unknown[]) => record(...a) }))

const { postComment, commentsFor } = await import('./comments-data')

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

beforeEach(() => {
  vi.clearAllMocks()
  assetUpsert.mockResolvedValue({ id: 'asset_cover' })
  commentCreate.mockResolvedValue({})
})

describe('postComment', () => {
  it('refuses an empty comment, and creates nothing', async () => {
    const res = await postComment('evt_1', 'cover', tui, '   ')
    expect(res.ok).toBe(false)
    expect(commentCreate).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses a key that is not in the set', async () => {
    const res = await postComment('evt_1', 'not-a-key', tui, 'hello')
    expect(res.ok).toBe(false)
    expect(commentCreate).not.toHaveBeenCalled()
  })

  it('creates the Asset row if there is not one yet, and attaches the comment to it', async () => {
    await postComment('evt_1', 'cover', tui, 'Looks great')
    expect(assetUpsert).toHaveBeenCalledWith({
      where: { eventId_key: { eventId: 'evt_1', key: 'cover' } },
      create: { eventId: 'evt_1', key: 'cover' },
      update: {},
      select: { id: true },
    })
    expect(commentCreate).toHaveBeenCalledWith({
      data: {
        eventId: 'evt_1',
        assetId: 'asset_cover',
        authorId: 'user_tui',
        who: 'TW',
        body: 'Looks great',
      },
    })
  })

  it('posts to the general thread when the key is null, touching no asset row', async () => {
    await postComment('evt_1', null, tui, 'General note')
    expect(assetUpsert).not.toHaveBeenCalled()
    expect(commentCreate).toHaveBeenCalledWith({
      data: {
        eventId: 'evt_1',
        assetId: null,
        authorId: 'user_tui',
        who: 'TW',
        body: 'General note',
      },
    })
  })

  it('is also an activity line, every time', async () => {
    await postComment('evt_1', 'cover', tui, 'Looks great')
    expect(record).toHaveBeenCalledOnce()
    expect(record).toHaveBeenCalledWith('evt_1', tui, expect.stringContaining('Looks great'))
  })

  it('trims the body before storing it', async () => {
    await postComment('evt_1', null, tui, '  spaced out  ')
    expect(commentCreate.mock.calls[0]![0].data.body).toBe('spaced out')
  })
})

describe('commentsFor', () => {
  it('splits rows into per-asset threads and the general thread', async () => {
    commentFindMany.mockResolvedValue([
      { id: 'c1', assetId: 'asset_cover', who: 'TW', body: 'a', at: new Date(2026, 8, 1) },
      { id: 'c2', assetId: null, who: 'MK', body: 'b', at: new Date(2026, 8, 2) },
      { id: 'c3', assetId: 'asset_cover', who: 'MK', body: 'c', at: new Date(2026, 8, 3) },
    ])

    const { byAsset, general } = await commentsFor('evt_1')

    expect(commentFindMany).toHaveBeenCalledWith({
      where: { eventId: 'evt_1' },
      orderBy: { at: 'asc' },
    })
    expect(byAsset.get('asset_cover')?.map((c) => c.id)).toEqual(['c1', 'c3'])
    expect(general.map((c) => c.id)).toEqual(['c2'])
  })

  it('carries who and body straight through, with a relative time label', async () => {
    commentFindMany.mockResolvedValue([
      { id: 'c1', assetId: null, who: 'TW', body: 'hello', at: new Date() },
    ])
    const { general } = await commentsFor('evt_1')
    expect(general[0]).toMatchObject({ id: 'c1', who: 'TW', body: 'hello' })
    expect(general[0]?.atLabel).toBe('just now')
  })
})
