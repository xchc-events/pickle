import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What a touring act's link can do.
 *
 * Connor, 23 Sep 2026: "File requests to an act carry the act, so a rider
 * uploaded through a grant lands on that act." `resolveGrant` (tested in its
 * own right in grants-data.test.ts-shaped fashion elsewhere, mocked here)
 * resolves which act the grant's payee is linked as on the grant's event;
 * `beginViaGrant` just has to hand that straight to `files.begin`.
 */

const resolveGrant = vi.fn()
vi.mock('@/lib/grants-data', () => ({
  resolveGrant: (...a: unknown[]) => resolveGrant(...a),
}))

const saveDetails = vi.fn()
vi.mock('@/lib/payments-data', () => ({
  saveDetails: (...a: unknown[]) => saveDetails(...a),
}))

const begin = vi.fn()
const finish = vi.fn()
vi.mock('@/lib/files-data', () => ({
  begin: (...a: unknown[]) => begin(...a),
  finish: (...a: unknown[]) => finish(...a),
}))

const findFile = vi.fn()
vi.mock('@/lib/db', () => ({
  db: { storedFile: { findUnique: (...a: unknown[]) => findFile(...a) } },
}))

const { beginViaGrant } = await import('./actions')

const TOKEN = 'tok_abc'

const openGrant = (over: Record<string, unknown> = {}) => ({
  id: 'grant_1',
  scope: 'RIDER',
  payeeId: 'pay_1',
  payeeName: 'Static Bloom Ltd',
  payeeCountry: 'NZ',
  eventId: 'evt_1',
  eventName: 'Static Bloom',
  eventDate: new Date('2026-10-01'),
  artistId: null,
  artistName: null,
  expires: new Date('2026-10-10'),
  firstUse: false,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  begin.mockResolvedValue({ ok: true, fileId: 'file_1', url: 'https://r2.example/put' })
})

describe('a rider uploaded through a grant', () => {
  it('lands on the act the grant resolved, once one is on it', async () => {
    resolveGrant.mockResolvedValue(openGrant({ artistId: 'art_1', artistName: 'Static Bloom' }))

    const out = await beginViaGrant(TOKEN, 'RIDER_TECH', 'rider.pdf', 'application/pdf', 1024)

    expect(out.ok).toBe(true)
    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt_1',
        payeeId: 'pay_1',
        artistId: 'art_1',
        grantId: 'grant_1',
      }),
    )
  })

  it('carries no act when the grant did not resolve one', async () => {
    resolveGrant.mockResolvedValue(openGrant({ artistId: null, artistName: null }))

    await beginViaGrant(TOKEN, 'RIDER_TECH', 'rider.pdf', 'application/pdf', 1024)

    expect(begin).toHaveBeenCalledWith(expect.objectContaining({ artistId: null }))
  })

  it('still refuses a link with no file scope, before any of that matters', async () => {
    resolveGrant.mockResolvedValue(openGrant({ scope: 'PAYMENT_DETAILS' }))

    const out = await beginViaGrant(TOKEN, 'RIDER_TECH', 'rider.pdf', 'application/pdf', 1024)

    expect(out.ok).toBe(false)
    expect(begin).not.toHaveBeenCalled()
  })

  it('still refuses a kind outside what an outside party may write', async () => {
    resolveGrant.mockResolvedValue(openGrant({ artistId: 'art_1' }))

    const out = await beginViaGrant(TOKEN, 'BRAND', 'logo.svg', 'image/svg+xml', 1024)

    expect(out.ok).toBe(false)
    expect(begin).not.toHaveBeenCalled()
  })
})
