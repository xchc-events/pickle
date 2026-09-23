import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Confirm/decline via the emailed link. No session at all — the token
 * itself is the permission, on the AccessGrant pattern: shaped like one of
 * ours before the database is touched, then looked up by its hash. The
 * actual confirm/decline transaction is shared with Roster and Home and is
 * tested once, in src/lib/shift-offers-data.test.ts.
 */

const offerFindUnique = vi.fn()
vi.mock('@/lib/db', () => ({
  db: { shiftOffer: { findUnique: (...a: unknown[]) => offerFindUnique(...a) } },
}))

const confirmOfferedShift = vi.fn()
const declineOfferedShift = vi.fn()
vi.mock('@/lib/shift-offers-data', () => ({
  confirmOfferedShift: (...a: unknown[]) => confirmOfferedShift(...a),
  declineOfferedShift: (...a: unknown[]) => declineOfferedShift(...a),
}))

const refresh = vi.fn()
vi.mock('next/cache', () => ({ refresh: () => refresh() }))

const { confirmViaToken, declineViaToken } = await import('./actions')

const GOOD_TOKEN = 'A'.repeat(43)

beforeEach(() => {
  vi.clearAllMocks()
  offerFindUnique.mockResolvedValue({
    shiftId: 'shift_bar',
    personId: 'person_ari',
    person: { initials: 'AN' },
  })
})

describe('confirmViaToken', () => {
  it('hashes the token and never queries by its raw value', async () => {
    confirmOfferedShift.mockResolvedValue({ kind: 'good', text: 'Ari Ngata is on Bar staff.' })

    await confirmViaToken(GOOD_TOKEN)

    expect(offerFindUnique).toHaveBeenCalledTimes(1)
    const where = offerFindUnique.mock.calls[0][0].where
    expect(where.tokenHash).not.toBe(GOOD_TOKEN)
    expect(typeof where.tokenHash).toBe('string')
  })

  it('confirms once — delegates to the shared transaction with the offer’s own actor', async () => {
    confirmOfferedShift.mockResolvedValue({ kind: 'good', text: 'Ari Ngata is on Bar staff.' })

    const out = await confirmViaToken(GOOD_TOKEN)

    expect(confirmOfferedShift).toHaveBeenCalledWith('shift_bar', {
      personId: 'person_ari',
      who: 'AN',
    })
    expect(out.text).toBe('Ari Ngata is on Bar staff.')
    expect(refresh).toHaveBeenCalled()
  })

  it('a malformed token is refused before the database is touched', async () => {
    const out = await confirmViaToken('too-short')

    expect(out.kind).toBe('stop')
    expect(offerFindUnique).not.toHaveBeenCalled()
    expect(confirmOfferedShift).not.toHaveBeenCalled()
  })

  it('a token nothing matches is refused, and nothing is confirmed', async () => {
    offerFindUnique.mockResolvedValue(null)

    const out = await confirmViaToken(GOOD_TOKEN)

    expect(out.kind).toBe('stop')
    expect(confirmOfferedShift).not.toHaveBeenCalled()
  })
})

describe('declineViaToken', () => {
  it('delegates to the shared transaction with the offer’s own actor', async () => {
    declineOfferedShift.mockResolvedValue({ kind: 'warn', text: 'Bar staff is open again.' })

    const out = await declineViaToken(GOOD_TOKEN)

    expect(declineOfferedShift).toHaveBeenCalledWith('shift_bar', {
      personId: 'person_ari',
      who: 'AN',
    })
    expect(out.text).toBe('Bar staff is open again.')
    expect(refresh).toHaveBeenCalled()
  })

  it('a token nothing matches is refused', async () => {
    offerFindUnique.mockResolvedValue(null)

    const out = await declineViaToken(GOOD_TOKEN)

    expect(out.kind).toBe('stop')
    expect(declineOfferedShift).not.toHaveBeenCalled()
  })
})
