import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ASSET_SET } from '@/lib/design'
import type { SessionUser } from '@/lib/session'

/**
 * Signing off the last piece of the design set.
 *
 * It used to move the event to On sale on its own and push every listing
 * that syncs itself — Gather.rsvp included, so finishing the artwork put
 * tickets on sale. With each part of an event moving on its own, that is two
 * things wrong: design being finished says nothing about whether the show
 * should be selling, and pushing Gather.rsvp from here would walk straight
 * past the rule that tickets wait for a confirmed booking.
 *
 * So finishing the set finishes the set, and nothing else.
 */

vi.mock('@/lib/permissions', () => ({
  requireModule: vi.fn(async () => ({ user: tui, modules: ['design'] })),
  requireEvent: vi.fn(async (_: unknown, id: string) => id),
}))

// Design's uploads reach R2 through this; nothing here uploads anything.
vi.mock('@/lib/files-data', () => ({}))

const assetUpsert = vi.fn()
const assetFindMany = vi.fn()
const eventUpdate = vi.fn()
const channelUpsert = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    asset: {
      upsert: (...a: unknown[]) => assetUpsert(...a),
      findMany: (...a: unknown[]) => assetFindMany(...a),
    },
    event: { update: (...a: unknown[]) => eventUpdate(...a) },
    channelPush: { upsert: (...a: unknown[]) => channelUpsert(...a) },
  },
}))

const record = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...a: unknown[]) => record(...a) }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))

const tui = {
  id: 'user_tui',
  name: 'Tui Ware',
  role: 'DESIGN',
  roleKey: 'design',
  organisationId: null,
  organisationName: null,
  external: false,
  personId: 'person_tui',
  initials: 'TW',
  authenticated: true,
} satisfies SessionUser

const { approveAsset } = await import('./actions')

const EVENT = 'evt_static_bloom'
const everyPieceApproved = ASSET_SET.map((a) => ({
  key: a.key,
  state: 'APPROVED',
  promoterSigned: true,
}))

beforeEach(() => {
  vi.clearAllMocks()
  assetUpsert.mockResolvedValue({})
  eventUpdate.mockResolvedValue({})
  // After the upsert, the whole set reads back approved: this was the last one.
  assetFindMany.mockResolvedValue(everyPieceApproved)
})

describe('approving the last piece of the set', () => {
  it('puts nothing on sale and pushes no listing', async () => {
    await approveAsset(EVENT, 'listing')
    expect(channelUpsert).not.toHaveBeenCalled()
  })

  it('moves nothing else on the event', async () => {
    await approveAsset(EVENT, 'listing')
    // The one write to the event is clearing a flag that was about the creative.
    expect(eventUpdate).toHaveBeenCalledOnce()
    expect(eventUpdate.mock.calls[0]![0]).toEqual({
      where: { id: EVENT },
      data: { riskNote: null },
    })
  })

  it('records the sign-off, and no move to On sale', async () => {
    await approveAsset(EVENT, 'listing')
    const lines = record.mock.calls.map((c) => c[2] as string)
    expect(lines).toEqual(['approved Listing copy'])
  })

  it('says the design is finished, and where the listings go out from', async () => {
    const out = await approveAsset(EVENT, 'listing')
    expect(out.kind).toBe('good')
    expect(out.text).toMatch(/last piece/)
    expect(out.text).not.toMatch(/On sale/)
    expect(out.text).toMatch(/Promotion/)
  })
})
