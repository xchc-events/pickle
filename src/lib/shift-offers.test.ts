import { describe, expect, it } from 'vitest'
import {
  offerUnavailableMessage,
  SHIFT_OFFER_TTL_DAYS,
  shiftOfferExpiryFrom,
  shiftOfferOutcome,
} from './shift-offers'

/**
 * The offer's own state, worked out without a database: whether a link is
 * still one somebody can act on, and why not when it is not. The three ways
 * an offer stops being live — answered, expired, or the shift moved on some
 * other way while the link sat in an inbox — read as different messages, not
 * one generic "invalid link".
 */

describe('shiftOfferExpiryFrom', () => {
  it('is seven days out', () => {
    expect(SHIFT_OFFER_TTL_DAYS).toBe(7)
    const now = new Date('2026-09-23T00:00:00Z')
    expect(shiftOfferExpiryFrom(now)).toEqual(new Date('2026-09-30T00:00:00Z'))
  })
})

const base = {
  expires: new Date('2026-09-30T00:00:00Z'),
  respondedAt: null as Date | null,
  response: null as 'CONFIRMED' | 'DECLINED' | null,
  shiftState: 'OFFERED',
  shiftPersonId: 'person_ari',
  offerPersonId: 'person_ari',
}

const NOW = new Date('2026-09-24T00:00:00Z')

describe('shiftOfferOutcome', () => {
  it('is live when nothing has happened yet and the shift still matches', () => {
    expect(shiftOfferOutcome(base, NOW)).toEqual({ live: true })
  })

  it('is not live once it has been responded to, and says confirmed', () => {
    expect(shiftOfferOutcome({ ...base, respondedAt: NOW, response: 'CONFIRMED' }, NOW)).toEqual({
      live: false,
      reason: 'confirmed',
    })
  })

  it('is not live once it has been responded to, and says declined', () => {
    expect(shiftOfferOutcome({ ...base, respondedAt: NOW, response: 'DECLINED' }, NOW)).toEqual({
      live: false,
      reason: 'declined',
    })
  })

  it('a response wins even if the expiry has also passed', () => {
    expect(
      shiftOfferOutcome(
        { ...base, respondedAt: NOW, response: 'CONFIRMED', expires: new Date('2026-09-01') },
        NOW,
      ),
    ).toEqual({ live: false, reason: 'confirmed' })
  })

  it('is expired once the expiry has passed with no response', () => {
    expect(shiftOfferOutcome({ ...base, expires: new Date('2026-09-01') }, NOW)).toEqual({
      live: false,
      reason: 'expired',
    })
  })

  it('is expired exactly at the expiry instant', () => {
    expect(shiftOfferOutcome({ ...base, expires: NOW }, NOW)).toEqual({
      live: false,
      reason: 'expired',
    })
  })

  it('is superseded when the shift has moved on to some other state', () => {
    expect(shiftOfferOutcome({ ...base, shiftState: 'ASSIGNED' }, NOW)).toEqual({
      live: false,
      reason: 'superseded',
    })
  })

  it('is superseded when the shift was re-offered to somebody else', () => {
    expect(shiftOfferOutcome({ ...base, shiftPersonId: 'person_amy' }, NOW)).toEqual({
      live: false,
      reason: 'superseded',
    })
  })

  it('is superseded when the shift was cleared back to open', () => {
    expect(shiftOfferOutcome({ ...base, shiftState: 'OPEN', shiftPersonId: null }, NOW)).toEqual({
      live: false,
      reason: 'superseded',
    })
  })
})

describe('offerUnavailableMessage', () => {
  it('names each reason in words a crew member would read', () => {
    expect(offerUnavailableMessage('confirmed')).toMatch(/already confirmed/i)
    expect(offerUnavailableMessage('declined')).toMatch(/already said/i)
    expect(offerUnavailableMessage('expired')).toMatch(/expired/i)
    expect(offerUnavailableMessage('superseded')).toMatch(/no longer/i)
  })
})
