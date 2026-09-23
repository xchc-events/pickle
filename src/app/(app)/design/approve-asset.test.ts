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

vi.mock('server-only', () => ({}))

// The mocked `requireModule` ignores which module was asked for — every
// test here names its own `user` through `.mockResolvedValue`, never the
// module key — so the wrapper below takes no arguments either.
const requireModule = vi.fn(async (): Promise<{ user: SessionUser; modules: string[] }> => ({
  user: tui,
  modules: ['design'],
}))
vi.mock('@/lib/permissions', () => ({
  requireModule: () => requireModule(),
  requireEvent: vi.fn(async (_: unknown, id: string) => id),
}))

// Design's uploads reach R2 through this; nothing here uploads anything.
vi.mock('@/lib/files-data', () => ({}))

const assetUpsert = vi.fn()
const assetFindMany = vi.fn()
const assetUpdateMany = vi.fn()
const eventFindUnique = vi.fn()
const eventUpdate = vi.fn()
const channelUpsert = vi.fn()
const commentCreate = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    asset: {
      upsert: (...a: unknown[]) => assetUpsert(...a),
      findMany: (...a: unknown[]) => assetFindMany(...a),
      updateMany: (...a: unknown[]) => assetUpdateMany(...a),
    },
    event: {
      findUnique: (...a: unknown[]) => eventFindUnique(...a),
      update: (...a: unknown[]) => eventUpdate(...a),
    },
    channelPush: { upsert: (...a: unknown[]) => channelUpsert(...a) },
    comment: { create: (...a: unknown[]) => commentCreate(...a) },
  },
}))

const record = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...a: unknown[]) => record(...a) }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))

const tui = {
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
  requireModule.mockResolvedValue({ user: tui, modules: ['design'] })
  assetUpsert.mockResolvedValue({})
  assetUpdateMany.mockResolvedValue({ count: 1 })
  eventUpdate.mockResolvedValue({})
  commentCreate.mockResolvedValue({})
  // Tui owns this event for the purposes of these tests — `maySignOff`
  // checks the person, not the role, and nothing here is about who the
  // owner is. "who may approve" below points ownerId elsewhere.
  eventFindUnique.mockResolvedValue({ ownerId: tui.personId, promoterId: 'payee_koura' })
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

/**
 * D6, Connor 23 Sep 2026: "sign-off can happen from either the external
 * promoter or the internal event owner" — and nobody else, however many
 * modules their own account carries. The permission itself is proven in
 * design-signoff.test.ts; this proves `approveAsset` actually reaches it.
 */
describe('who may approve', () => {
  const otherCoordinator: SessionUser = {
    ...tui,
    id: 'user_other',
    name: 'Other Coordinator',
    role: 'COORDINATOR',
    roleKey: 'coordinator',
    personId: 'person_other',
    initials: 'OC',
  }
  const promoterOfOwnOrg: SessionUser = {
    ...tui,
    id: 'user_promo',
    name: 'Kōura Promoter',
    role: 'PROMOTER',
    roleKey: 'promoter',
    external: true,
    personId: null,
    organisationId: 'payee_koura',
    initials: 'KP',
  }
  const promoterOfAnotherOrg: SessionUser = {
    ...promoterOfOwnOrg,
    id: 'user_other_promo',
    organisationId: 'payee_wheke',
  }
  const owner: SessionUser = {
    ...tui,
    id: 'user_owner',
    name: 'The Owner',
    role: 'COORDINATOR',
    roleKey: 'coordinator',
  }

  it('refuses a design-role user who is not this event’s owner', async () => {
    eventFindUnique.mockResolvedValue({ ownerId: 'person_someone_else', promoterId: 'payee_koura' })
    requireModule.mockResolvedValue({ user: tui, modules: ['design'] })
    const out = await approveAsset(EVENT, 'listing')
    expect(out.kind).toBe('stop')
    expect(assetUpsert).not.toHaveBeenCalled()
  })

  it('refuses a coordinator who is not this event’s owner', async () => {
    requireModule.mockResolvedValue({ user: otherCoordinator, modules: ['design'] })
    const out = await approveAsset(EVENT, 'listing')
    expect(out.kind).toBe('stop')
    expect(assetUpsert).not.toHaveBeenCalled()
  })

  it('refuses a promoter from another organisation', async () => {
    requireModule.mockResolvedValue({ user: promoterOfAnotherOrg, modules: ['design'] })
    const out = await approveAsset(EVENT, 'listing')
    expect(out.kind).toBe('stop')
    expect(assetUpsert).not.toHaveBeenCalled()
  })

  it('allows the event’s internal owner', async () => {
    // owner.personId is tui's — eventFindUnique above already names that
    // person the owner, so this only proves the role does not matter.
    requireModule.mockResolvedValue({ user: owner, modules: ['design'] })
    const out = await approveAsset(EVENT, 'listing')
    expect(out.kind).not.toBe('stop')
    expect(assetUpsert).toHaveBeenCalled()
  })

  it('allows a promoter of the event’s own organisation', async () => {
    requireModule.mockResolvedValue({ user: promoterOfOwnOrg, modules: ['design'] })
    const out = await approveAsset(EVENT, 'listing')
    expect(out.kind).not.toBe('stop')
    expect(assetUpsert).toHaveBeenCalled()
  })
})
