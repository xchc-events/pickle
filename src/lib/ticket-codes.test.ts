import { describe, expect, it } from 'vitest'
import {
  codeState,
  codeValueLabel,
  normaliseCode,
  validateTicketCode,
  type TicketCodeInput,
} from './ticket-codes'

/**
 * `validateTicketCode` is what `addCode` refuses on before anything reaches
 * the database — one check per rule T6 states: a code normalises to upper
 * case with no spaces, PERCENT_OFF and AMOUNT_OFF need a value and FREE and
 * UNLOCKS_TIER carry none, UNLOCKS_TIER has to say which tier, and a use
 * limit is a whole number above zero or left blank for unlimited.
 */

const valid: TicketCodeInput = {
  code: 'locals',
  kind: 'PERCENT_OFF',
  value: 10,
  tierKey: null,
  useLimit: null,
}

describe('normaliseCode', () => {
  it('upper-cases and strips spaces', () => {
    expect(normaliseCode(' locals discount ')).toBe('LOCALSDISCOUNT')
  })

  it('leaves an already clean code alone', () => {
    expect(normaliseCode('LOCALS10')).toBe('LOCALS10')
  })
})

describe('validateTicketCode', () => {
  it('accepts a valid percent-off code, normalising its case and spacing', () => {
    const result = validateTicketCode(valid)
    expect(result).toEqual({ ok: true, code: 'LOCALS' })
  })

  it('refuses a code with nothing in it once normalised', () => {
    expect(validateTicketCode({ ...valid, code: '   ' })).toEqual({
      ok: false,
      error: expect.stringMatching(/character/i),
    })
  })

  it('refuses a code with punctuation other than a dash', () => {
    expect(validateTicketCode({ ...valid, code: 'locals!' })).toEqual({
      ok: false,
      error: expect.stringMatching(/letters, numbers/i),
    })
  })

  it('refuses PERCENT_OFF with no value', () => {
    expect(validateTicketCode({ ...valid, value: null })).toEqual({
      ok: false,
      error: expect.stringMatching(/value/i),
    })
  })

  it('refuses a percent above 100', () => {
    expect(validateTicketCode({ ...valid, value: 150 })).toEqual({
      ok: false,
      error: expect.stringMatching(/100/),
    })
  })

  it('refuses AMOUNT_OFF with a zero or negative value', () => {
    expect(validateTicketCode({ ...valid, kind: 'AMOUNT_OFF', value: 0 })).toEqual({
      ok: false,
      error: expect.stringMatching(/value/i),
    })
  })

  it('refuses an amount off above the $500 ceiling', () => {
    expect(validateTicketCode({ ...valid, kind: 'AMOUNT_OFF', value: 501 })).toEqual({
      ok: false,
      error: expect.stringMatching(/500/),
    })
  })

  it('refuses FREE carrying a value', () => {
    expect(validateTicketCode({ ...valid, kind: 'FREE', value: 10 })).toEqual({
      ok: false,
      error: expect.stringMatching(/no figure|blank/i),
    })
  })

  it('accepts FREE with a null value and no tier', () => {
    expect(validateTicketCode({ ...valid, kind: 'FREE', value: null })).toEqual({
      ok: true,
      code: 'LOCALS',
    })
  })

  it('refuses UNLOCKS_TIER with no tier named', () => {
    expect(
      validateTicketCode({ ...valid, kind: 'UNLOCKS_TIER', value: null, tierKey: null }),
    ).toEqual({
      ok: false,
      error: expect.stringMatching(/which one|tier/i),
    })
  })

  it('refuses UNLOCKS_TIER carrying a value', () => {
    expect(
      validateTicketCode({ ...valid, kind: 'UNLOCKS_TIER', value: 10, tierKey: 'sup' }),
    ).toEqual({
      ok: false,
      error: expect.stringMatching(/no figure|blank/i),
    })
  })

  it('accepts UNLOCKS_TIER with a real tier and no value', () => {
    expect(
      validateTicketCode({ ...valid, kind: 'UNLOCKS_TIER', value: null, tierKey: 'sup' }),
    ).toEqual({ ok: true, code: 'LOCALS' })
  })

  it('refuses a tier key that is not one of the four', () => {
    expect(validateTicketCode({ ...valid, tierKey: 'vip' })).toEqual({
      ok: false,
      error: expect.stringMatching(/tier/i),
    })
  })

  it('refuses a use limit that is not a positive whole number', () => {
    expect(validateTicketCode({ ...valid, useLimit: 0 })).toEqual({
      ok: false,
      error: expect.stringMatching(/use limit/i),
    })
    expect(validateTicketCode({ ...valid, useLimit: 2.5 })).toEqual({
      ok: false,
      error: expect.stringMatching(/use limit/i),
    })
  })

  it('accepts a null use limit as unlimited', () => {
    expect(validateTicketCode({ ...valid, useLimit: null })).toEqual({
      ok: true,
      code: 'LOCALS',
    })
  })
})

describe('codeState', () => {
  const now = new Date('2026-09-23T12:00:00+13:00')
  const base = { active: true, activeFrom: null, activeTo: null, useLimit: null, uses: 0 }

  it('is off when the active flag is off, regardless of dates or uses', () => {
    expect(codeState({ ...base, active: false }, now)).toBe('off')
  })

  it('is scheduled before its activeFrom date', () => {
    const activeFrom = new Date('2026-10-01T00:00:00+13:00')
    expect(codeState({ ...base, activeFrom }, now)).toBe('scheduled')
  })

  it('is expired after its activeTo date', () => {
    const activeTo = new Date('2026-09-01T00:00:00+13:00')
    expect(codeState({ ...base, activeTo }, now)).toBe('expired')
  })

  it('is exhausted once uses reaches the use limit', () => {
    expect(codeState({ ...base, useLimit: 30, uses: 30 }, now)).toBe('exhausted')
    expect(codeState({ ...base, useLimit: 30, uses: 29 }, now)).toBe('active')
  })

  it('is active when none of the above apply', () => {
    expect(codeState(base, now)).toBe('active')
  })
})

describe('codeValueLabel', () => {
  it('labels a percent-off code', () => {
    expect(codeValueLabel('PERCENT_OFF', 10, null)).toBe('10% off')
  })

  it('labels an amount-off code in dollars', () => {
    expect(codeValueLabel('AMOUNT_OFF', 5, null)).toBe('$5 off')
  })

  it('labels a free code', () => {
    expect(codeValueLabel('FREE', null, null)).toBe('Free ticket')
  })

  it('labels an unlock code by its tier', () => {
    expect(codeValueLabel('UNLOCKS_TIER', null, 'sup')).toBe('Unlocks sup')
  })
})
