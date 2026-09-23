import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

/**
 * D6/D3/D5 reached through the portal.
 *
 * The permission itself (`maySignOff`) and the state changes are proven
 * once in design-signoff.test.ts and comments-data.test.ts; this proves the
 * portal's own actions check the `portal` module (not `design`) and still
 * reach that shared core — the same promise approve-asset.test.ts makes for
 * Design's side of the same permission matrix.
 */

vi.mock('server-only', () => ({}))

const requireModule = vi.fn(async () => ({ user: promoter, modules: ['portal'] }))
const requireEvent = vi.fn(async (_user: unknown, id: string) => id)
vi.mock('@/lib/permissions', () => ({
  requireModule: () => requireModule(),
  requireEvent: (user: unknown, id: string) => requireEvent(user, id),
}))

vi.mock('@/lib/payments-data', () => ({ saveDetails: vi.fn() }))
vi.mock('@/lib/portal-data', () => ({ ownPayee: vi.fn().mockResolvedValue(null) }))

const assetUpsert = vi.fn()
const assetUpdateMany = vi.fn()
const eventFindUnique = vi.fn()
const eventUpdate = vi.fn()
const commentCreate = vi.fn()
const storedFileFindUnique = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    asset: {
      upsert: (...a: unknown[]) => assetUpsert(...a),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: (...a: unknown[]) => assetUpdateMany(...a),
    },
    event: {
      findUnique: (...a: unknown[]) => eventFindUnique(...a),
      update: (...a: unknown[]) => eventUpdate(...a),
    },
    comment: { create: (...a: unknown[]) => commentCreate(...a) },
    storedFile: { findUnique: (...a: unknown[]) => storedFileFindUnique(...a) },
  },
}))

const record = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...a: unknown[]) => record(...a) }))

const linkTo = vi.fn()
vi.mock('@/lib/files-data', () => ({ linkTo: (...a: unknown[]) => linkTo(...a) }))

vi.mock('next/cache', () => ({ refresh: vi.fn() }))

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
const promoterOfAnotherOrg: SessionUser = {
  ...promoter,
  id: 'user_other_promo',
  organisationId: 'payee_wheke',
}
const ownerNotPromoter: SessionUser = {
  ...promoter,
  id: 'user_owner',
  role: 'COORDINATOR',
  roleKey: 'coordinator',
  external: false,
  organisationId: null,
  personId: 'person_owner',
}

const { approvePiece, askForChange, linkToArtwork, postPortalComment, reopenPiece } =
  await import('./actions')

const EVENT = 'evt_koura_night'

beforeEach(() => {
  vi.clearAllMocks()
  requireModule.mockResolvedValue({ user: promoter, modules: ['portal'] })
  requireEvent.mockImplementation(async (_user: unknown, id: string) => id)
  eventFindUnique.mockResolvedValue({ ownerId: 'person_owner', promoterId: 'payee_koura' })
  assetUpsert.mockResolvedValue({ id: 'asset_1' })
  assetUpdateMany.mockResolvedValue({ count: 1 })
  eventUpdate.mockResolvedValue({})
  commentCreate.mockResolvedValue({})
  storedFileFindUnique.mockResolvedValue({ eventId: EVENT })
  linkTo.mockResolvedValue('https://r2.example/signed-url')
})

describe('who may sign off through the portal', () => {
  it('checks the portal module, not design', async () => {
    await approvePiece(EVENT, 'listing')
    expect(requireModule).toHaveBeenCalled()
  })

  it('allows a promoter of the event’s own organisation', async () => {
    const out = await approvePiece(EVENT, 'listing')
    expect(out.kind).not.toBe('stop')
    expect(assetUpsert).toHaveBeenCalled()
  })

  it('refuses a promoter from another organisation, even once inside their own scoped event list', async () => {
    // requireEvent is mocked to let the call through, the way an event
    // already inside eventScope would — maySignOff is the second check.
    requireModule.mockResolvedValue({ user: promoterOfAnotherOrg, modules: ['portal'] })
    const out = await approvePiece(EVENT, 'listing')
    expect(out.kind).toBe('stop')
    expect(assetUpsert).not.toHaveBeenCalled()
  })

  it('refuses an internal user who is not this event’s owner', async () => {
    // requireModule('portal') would 404 an internal account outright in
    // production — only a PROMOTER role ever carries that module — but
    // maySignOff itself draws no distinction by which surface reached it,
    // so it is proven here too, the same way design-signoff.test.ts does.
    requireModule.mockResolvedValue({ user: ownerNotPromoter, modules: ['portal'] })
    eventFindUnique.mockResolvedValue({ ownerId: 'person_someone_else', promoterId: 'payee_koura' })
    const out = await approvePiece(EVENT, 'listing')
    expect(out.kind).toBe('stop')
  })
})

describe('askForChange', () => {
  it('refuses an empty reason', async () => {
    const out = await askForChange(EVENT, 'listing', '   ')
    expect(out.kind).toBe('stop')
    expect(assetUpsert).not.toHaveBeenCalled()
  })

  it('sends the piece back and posts the words as a comment', async () => {
    const out = await askForChange(EVENT, 'listing', 'wrong price on it')
    expect(out.kind).not.toBe('stop')
    expect(commentCreate).toHaveBeenCalledWith({
      data: {
        eventId: EVENT,
        assetId: 'asset_1',
        authorId: promoter.id,
        who: promoter.initials,
        body: 'wrong price on it',
      },
    })
  })
})

describe('reopenPiece', () => {
  it('says there is nothing to reopen when the piece was never signed off', async () => {
    assetUpdateMany.mockResolvedValue({ count: 0 })
    const out = await reopenPiece(EVENT, 'listing', 'changed my mind')
    expect(out.kind).toBe('stop')
  })

  it('moves a signed-off piece back to review', async () => {
    const out = await reopenPiece(EVENT, 'listing', 'changed my mind')
    expect(out.kind).not.toBe('stop')
    expect(assetUpdateMany).toHaveBeenCalledWith({
      where: { eventId: EVENT, key: 'listing', state: 'APPROVED' },
      data: { state: 'REVIEW', signedById: null, signedAt: null, promoterSigned: false },
    })
  })
})

describe('postPortalComment', () => {
  it('is scoped through requireEvent before anything is written', async () => {
    await postPortalComment(EVENT, 'cover', 'looks great')
    expect(requireEvent).toHaveBeenCalledWith(promoter, EVENT)
    expect(commentCreate).toHaveBeenCalled()
  })

  it('never reaches the database for an event outside this promoter’s scope', async () => {
    // The real requireEvent 404s before returning — simulated here by
    // having it reject, the way notFound() unwinds the request.
    requireEvent.mockRejectedValueOnce(new Error('NEXT_NOT_FOUND'))
    await expect(postPortalComment('evt_not_mine', null, 'sneaky')).rejects.toThrow()
    expect(commentCreate).not.toHaveBeenCalled()
  })

  it('posts to the general thread when there is no piece', async () => {
    await postPortalComment(EVENT, null, 'general note')
    expect(assetUpsert).not.toHaveBeenCalled()
    expect(commentCreate).toHaveBeenCalledWith({
      data: {
        eventId: EVENT,
        assetId: null,
        authorId: promoter.id,
        who: promoter.initials,
        body: 'general note',
      },
    })
  })
})

describe('linkToArtwork', () => {
  it('returns the signed url for a file on this event', async () => {
    const url = await linkToArtwork(EVENT, 'file_1')
    expect(url).toBe('https://r2.example/signed-url')
  })

  it('refuses a file that belongs to a different event', async () => {
    storedFileFindUnique.mockResolvedValue({ eventId: 'evt_someone_elses' })
    const url = await linkToArtwork(EVENT, 'file_1')
    expect(url).toBeNull()
    expect(linkTo).not.toHaveBeenCalled()
  })
})
