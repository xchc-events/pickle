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

const LATER = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
const EARLIER = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)

/** A live offer: unanswered, unexpired, on a shift still held by its person. */
const liveOffer = (over: Record<string, unknown> = {}) => ({
  shiftId: 'shift_bar',
  personId: 'person_ari',
  expires: LATER,
  respondedAt: null,
  response: null,
  person: { initials: 'AN' },
  shift: { state: 'OFFERED', personId: 'person_ari' },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  offerFindUnique.mockResolvedValue(liveOffer())
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

    expect(confirmOfferedShift).toHaveBeenCalledWith(
      'shift_bar',
      { personId: 'person_ari', who: 'AN' },
      { offeredTo: 'person_ari' },
    )
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

    expect(declineOfferedShift).toHaveBeenCalledWith(
      'shift_bar',
      { personId: 'person_ari', who: 'AN' },
      { offeredTo: 'person_ari' },
    )
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

/**
 * The page is not the boundary — the same rule src/app/g/[token]/actions.ts
 * states for access grants. These are POST endpoints, and a caller supplying
 * their own token is the case they have to survive, so every liveness rule
 * the page renders off is re-checked here rather than assumed. Confirming
 * books an hour entry against the event, which is money.
 */
describe('an offer that is no longer live', () => {
  const dead = [
    ['expired', { expires: EARLIER }],
    ['already answered', { respondedAt: EARLIER, response: 'CONFIRMED' }],
    ['already declined', { respondedAt: EARLIER, response: 'DECLINED' }],
    [
      'superseded — the shift moved to somebody else',
      { shift: { state: 'OFFERED', personId: 'person_hana' } },
    ],
    ['superseded — the shift was taken back to open', { shift: { state: 'OPEN', personId: null } }],
  ] as const

  for (const [why, over] of dead) {
    it(`confirmViaToken refuses one that is ${why}, and books nothing`, async () => {
      offerFindUnique.mockResolvedValue(liveOffer(over))

      const out = await confirmViaToken(GOOD_TOKEN)

      expect(out.kind).toBe('stop')
      expect(confirmOfferedShift).not.toHaveBeenCalled()
    })

    it(`declineViaToken refuses one that is ${why}`, async () => {
      offerFindUnique.mockResolvedValue(liveOffer(over))

      const out = await declineViaToken(GOOD_TOKEN)

      expect(out.kind).toBe('stop')
      expect(declineOfferedShift).not.toHaveBeenCalled()
    })
  }

  it('says what happened, rather than pretending the link was never real', async () => {
    offerFindUnique.mockResolvedValue(liveOffer({ expires: EARLIER }))

    const out = await confirmViaToken(GOOD_TOKEN)

    expect(out.text).toMatch(/expired/i)
  })
})
