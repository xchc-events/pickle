import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `resolveGrant`'s newest piece: which act, if any, the grant's payee is
 * linked as on the grant's own event — see the note under Tech production,
 * 23 Sep 2026.
 */

vi.mock('server-only', () => ({}))

const findGrant = vi.fn()
const updateGrant = vi.fn()
const findArtist = vi.fn()
vi.mock('./db', () => ({
  db: {
    accessGrant: {
      findUnique: (...a: unknown[]) => findGrant(...a),
      update: (...a: unknown[]) => updateGrant(...a),
    },
    eventArtist: { findFirst: (...a: unknown[]) => findArtist(...a) },
  },
}))

const { resolveGrant } = await import('./grants-data')

const NOW = new Date('2026-09-23T12:00:00Z')

const row = (over: Record<string, unknown> = {}) => ({
  id: 'grant_1',
  scope: 'RIDER',
  expires: new Date('2026-10-10'),
  usedAt: new Date('2026-09-20'), // already used, so resolveGrant does not also write to it
  revokedAt: null,
  payee: { id: 'pay_1', name: 'Static Bloom Ltd', country: 'NZ' },
  event: { id: 'evt_1', name: 'Static Bloom', date: new Date('2026-10-01') },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  findArtist.mockResolvedValue(null)
})

describe('resolving the act a grant is for', () => {
  it('looks the payee up as a live act on the grant’s own event', async () => {
    findGrant.mockResolvedValue(row())
    findArtist.mockResolvedValue({ id: 'art_1', name: 'Static Bloom' })

    const grant = await resolveGrant('a'.repeat(43), NOW)

    expect(findArtist).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: 'evt_1', payeeId: 'pay_1' } }),
    )
    expect(grant).toMatchObject({ artistId: 'art_1', artistName: 'Static Bloom' })
  })

  it('carries no act when the payee is not linked as one on this event', async () => {
    findGrant.mockResolvedValue(row())
    findArtist.mockResolvedValue(null)

    const grant = await resolveGrant('a'.repeat(43), NOW)

    expect(grant).toMatchObject({ artistId: null, artistName: null })
  })

  it('does not look an act up at all for a grant with no event', async () => {
    findGrant.mockResolvedValue(row({ event: null }))

    const grant = await resolveGrant('a'.repeat(43), NOW)

    expect(findArtist).not.toHaveBeenCalled()
    expect(grant).toMatchObject({ artistId: null, artistName: null })
  })
})
