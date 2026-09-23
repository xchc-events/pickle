import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ASSET_SET } from './design'
import type { SessionUser } from './session'

/**
 * D6/D3 — signing a piece off, sending it back, and reopening it.
 *
 * Shared core behind Design's and the portal's own actions: each surface
 * checks its own module and event scope first (see approve-asset.test.ts
 * and portal/sign-off.test.ts), then calls straight into these. Permission
 * itself — who may sign — is proven once, here.
 */

vi.mock('server-only', () => ({}))

const assetUpsert = vi.fn()
const assetFindMany = vi.fn()
const assetUpdateMany = vi.fn()
const eventFindUnique = vi.fn()
const eventUpdate = vi.fn()
vi.mock('./db', () => ({
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
  },
}))

const record = vi.fn()
vi.mock('./activity', () => ({ record: (...a: unknown[]) => record(...a) }))

const postComment = vi.fn()
vi.mock('./comments-data', () => ({ postComment: (...a: unknown[]) => postComment(...a) }))

const { signOffAsset, sendBackAsset, reopenAsset } = await import('./design-signoff')

const owner: SessionUser = {
  id: 'user_owner',
  email: 'owner@xchc.test',
  name: 'Ana Owner',
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
const otherCoordinator: SessionUser = {
  ...owner,
  id: 'user_other',
  personId: 'person_other',
  initials: 'OC',
}
const designStaff: SessionUser = {
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
const promoter: SessionUser = {
  id: 'user_promo',
  email: 'promo@koura.test',
  name: 'Kōura Promoter',
  role: 'PROMOTER',
  roleKey: 'promoter',
  organisationId: 'payee_koura',
  organisationName: 'Kōura Collective',
  external: true,
  personId: null,
  initials: 'KP',
  authenticated: true,
  sessionId: 'session_promo',
}
const otherPromoter: SessionUser = {
  ...promoter,
  id: 'user_other_promo',
  organisationId: 'payee_wheke',
}

beforeEach(() => {
  vi.clearAllMocks()
  eventFindUnique.mockResolvedValue({ ownerId: 'person_owner', promoterId: 'payee_koura' })
  assetUpsert.mockResolvedValue({})
  assetUpdateMany.mockResolvedValue({ count: 1 })
  eventUpdate.mockResolvedValue({})
  postComment.mockResolvedValue({ ok: true })
  // Nothing approved yet, so signing one piece finds no other draft to
  // auto-advance and does not finish the set.
  assetFindMany.mockResolvedValue(
    ASSET_SET.map((a) => ({ key: a.key, state: 'DRAFT', promoterSigned: false })),
  )
})

describe('signOffAsset — who may sign', () => {
  it('refuses a design-role user', async () => {
    const out = await signOffAsset('evt_1', 'listing', designStaff)
    expect(out.kind).toBe('stop')
    expect(assetUpsert).not.toHaveBeenCalled()
  })

  it('refuses an internal coordinator who is not this event’s owner', async () => {
    const out = await signOffAsset('evt_1', 'listing', otherCoordinator)
    expect(out.kind).toBe('stop')
    expect(assetUpsert).not.toHaveBeenCalled()
  })

  it('refuses a promoter from another organisation', async () => {
    const out = await signOffAsset('evt_1', 'listing', otherPromoter)
    expect(out.kind).toBe('stop')
    expect(assetUpsert).not.toHaveBeenCalled()
  })

  it('allows the event’s internal owner', async () => {
    const out = await signOffAsset('evt_1', 'listing', owner)
    expect(out.kind).not.toBe('stop')
    expect(assetUpsert).toHaveBeenCalled()
  })

  it('allows a promoter of the event’s own organisation', async () => {
    const out = await signOffAsset('evt_1', 'listing', promoter)
    expect(out.kind).not.toBe('stop')
    expect(assetUpsert).toHaveBeenCalled()
  })

  it('refuses a piece that is not in the set', async () => {
    const out = await signOffAsset('evt_1', 'not-a-key', owner)
    expect(out.kind).toBe('stop')
    expect(assetUpsert).not.toHaveBeenCalled()
  })
})

describe('signOffAsset — what it records', () => {
  it('records the owner as the signer, and does not mark it a promoter sign-off', async () => {
    await signOffAsset('evt_1', 'listing', owner)
    expect(assetUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId_key: { eventId: 'evt_1', key: 'listing' } },
        create: expect.objectContaining({
          state: 'APPROVED',
          signedById: 'user_owner',
          signedAt: expect.any(Date),
          promoterSigned: false,
        }),
        update: expect.objectContaining({
          state: 'APPROVED',
          signedById: 'user_owner',
          signedAt: expect.any(Date),
          promoterSigned: false,
        }),
      }),
    )
  })

  it('records the promoter as the signer, and marks it a promoter sign-off', async () => {
    await signOffAsset('evt_1', 'listing', promoter)
    expect(assetUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ signedById: 'user_promo', promoterSigned: true }),
      }),
    )
  })

  it('pulls the next draft in house order up for review, as it always has', async () => {
    await signOffAsset('evt_1', 'listing', owner)
    const nextKey = ASSET_SET[0]!.key
    expect(assetUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId_key: { eventId: 'evt_1', key: nextKey } },
        update: { state: 'REVIEW' },
      }),
    )
  })

  it('records one activity line naming the piece', async () => {
    await signOffAsset('evt_1', 'cover', owner)
    expect(record).toHaveBeenCalledOnce()
    expect(record.mock.calls[0]![2]).toMatch(/approved/i)
  })

  it('clears the event’s risk note once the last piece is approved, and says so', async () => {
    assetFindMany.mockResolvedValue(
      ASSET_SET.map((a) => ({ key: a.key, state: 'APPROVED', promoterSigned: false })),
    )
    const out = await signOffAsset('evt_1', 'listing', owner)
    expect(eventUpdate).toHaveBeenCalledWith({ where: { id: 'evt_1' }, data: { riskNote: null } })
    expect(out.text).toMatch(/last piece/)
  })

  it('leaves the risk note alone while pieces remain', async () => {
    await signOffAsset('evt_1', 'listing', owner)
    expect(eventUpdate).not.toHaveBeenCalled()
  })
})

describe('sendBackAsset', () => {
  it('refuses anyone who may not sign, before it even asks for words', async () => {
    const out = await sendBackAsset('evt_1', 'listing', designStaff, 'needs work')
    expect(out.kind).toBe('stop')
    expect(assetUpsert).not.toHaveBeenCalled()
  })

  it('refuses an empty reason', async () => {
    const out = await sendBackAsset('evt_1', 'listing', owner, '   ')
    expect(out.kind).toBe('stop')
    expect(assetUpsert).not.toHaveBeenCalled()
  })

  it('sends the piece back to draft and clears its signature', async () => {
    await sendBackAsset('evt_1', 'listing', owner, 'wrong dates on the cover')
    expect(assetUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { state: 'DRAFT', signedById: null, signedAt: null, promoterSigned: false },
      }),
    )
  })

  it('posts the words as a comment on the piece', async () => {
    await sendBackAsset('evt_1', 'listing', promoter, 'wrong dates on the cover')
    expect(postComment).toHaveBeenCalledWith(
      'evt_1',
      'listing',
      promoter,
      'wrong dates on the cover',
    )
  })

  it('records its own activity line for the state change, on top of the comment’s', async () => {
    await sendBackAsset('evt_1', 'listing', owner, 'wrong dates on the cover')
    expect(record).toHaveBeenCalledOnce()
    expect(record.mock.calls[0]![2]).toMatch(/back/i)
  })
})

describe('reopenAsset', () => {
  it('refuses anyone who may not sign', async () => {
    const out = await reopenAsset('evt_1', 'listing', designStaff, 'wrong price')
    expect(out.kind).toBe('stop')
    expect(assetUpdateMany).not.toHaveBeenCalled()
  })

  it('refuses an empty reason', async () => {
    const out = await reopenAsset('evt_1', 'listing', owner, '   ')
    expect(out.kind).toBe('stop')
    expect(assetUpdateMany).not.toHaveBeenCalled()
  })

  it('says there is nothing to reopen when the piece was not approved', async () => {
    assetUpdateMany.mockResolvedValue({ count: 0 })
    const out = await reopenAsset('evt_1', 'listing', owner, 'wrong price')
    expect(out.kind).toBe('stop')
    expect(postComment).not.toHaveBeenCalled()
  })

  it('moves an approved piece back to review and clears its signature', async () => {
    await reopenAsset('evt_1', 'listing', owner, 'wrong price')
    expect(assetUpdateMany).toHaveBeenCalledWith({
      where: { eventId: 'evt_1', key: 'listing', state: 'APPROVED' },
      data: { state: 'REVIEW', signedById: null, signedAt: null, promoterSigned: false },
    })
  })

  it('posts the reason as a comment and records its own activity line too', async () => {
    await reopenAsset('evt_1', 'listing', promoter, 'wrong price')
    expect(postComment).toHaveBeenCalledWith('evt_1', 'listing', promoter, 'wrong price')
    expect(record).toHaveBeenCalledOnce()
    expect(record.mock.calls[0]![2]).toMatch(/reopen/i)
  })
})
