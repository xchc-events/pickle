import { describe, expect, it } from 'vitest'
import { canReveal, maskAccount, maskIrd, validateDetails } from './payments'

/**
 * The gate in front of decrypted payment details, and the validation in front
 * of encrypted ones.
 *
 * `canReveal` is the reason this file exists. Right now `currentUser()` is a
 * cookie carrying a user id and no credential — anyone able to set it is
 * anyone. That is tolerable for a pipeline row and not for a bank account, so
 * the reveal path refuses to run in production until a real session backs it.
 */

const finance = { roleKey: 'admin' as const, modules: ['finance'], external: false }

describe('canReveal', () => {
  it('lets Finance through when a real session backs the request', () => {
    expect(canReveal({ ...finance, authenticated: true, production: true }).ok).toBe(true)
  })

  it('refuses in production when the session is the cookie stub', () => {
    const v = canReveal({ ...finance, authenticated: false, production: true })
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.why).toMatch(/sign-in|session|authentic/i)
  })

  it('allows the stub in development, so the module can be built', () => {
    expect(canReveal({ ...finance, authenticated: false, production: false }).ok).toBe(true)
  })

  it('refuses anyone without the finance module, session or not', () => {
    const v = canReveal({
      ...finance,
      modules: ['pipeline'],
      authenticated: true,
      production: true,
    })
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.why).toMatch(/finance/i)
  })

  it('refuses an external promoter even when they carry the finance module', () => {
    // A promoter enters their own details and never reads them back. Nothing
    // outside the venue decrypts anything, whatever their permission rows say.
    const v = canReveal({ ...finance, external: true, authenticated: true, production: true })
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.why).toMatch(/outside|external|venue/i)
  })

  it('checks the module before the session, so the refusal names the real reason', () => {
    const v = canReveal({
      ...finance,
      modules: [],
      authenticated: false,
      production: true,
    })
    expect(v.ok === false && v.why).toMatch(/finance/i)
  })
})

describe('masking', () => {
  it('shows only the tail of an account', () => {
    expect(maskAccount('456')).toBe('••-••••-••••456-•••')
  })

  it('says so plainly when there is nothing on file', () => {
    expect(maskAccount(null)).toBe('Not on file')
    expect(maskAccount('')).toBe('Not on file')
  })

  it('shows only the tail of an IRD number', () => {
    expect(maskIrd('850')).toBe('•••-•••-850')
  })

  it('says so plainly when no IRD number is on file', () => {
    expect(maskIrd(null)).toBe('Not on file')
  })
})

describe('validateDetails', () => {
  const good = {
    account: '01-0123-0123456-000',
    accountName: 'Static Bloom Touring',
    ird: '49091850',
    country: 'NZ',
  }

  it('accepts a complete NZ set', () => {
    expect(validateDetails(good)).toEqual([])
  })

  it('rejects an account that is not one', () => {
    expect(validateDetails({ ...good, account: '123' })).toContainEqual(
      expect.objectContaining({ field: 'account' }),
    )
  })

  it('rejects an IRD number whose check digit does not hold', () => {
    expect(validateDetails({ ...good, ird: '49091851' })).toContainEqual(
      expect.objectContaining({ field: 'ird' }),
    )
  })

  it('requires the account holder name — a mismatch is what bounces a payment', () => {
    expect(validateDetails({ ...good, accountName: '  ' })).toContainEqual(
      expect.objectContaining({ field: 'accountName' }),
    )
  })

  it('does not require an IRD number from a non-resident', () => {
    expect(validateDetails({ ...good, ird: '', country: 'AU' })).toEqual([])
  })

  it('does require an IRD number from an NZ payee', () => {
    expect(validateDetails({ ...good, ird: '' })).toContainEqual(
      expect.objectContaining({ field: 'ird' }),
    )
  })

  it('still checks a non-resident IRD number when one is given', () => {
    expect(validateDetails({ ...good, ird: '11111111', country: 'AU' })).toContainEqual(
      expect.objectContaining({ field: 'ird' }),
    )
  })

  it('reports every problem at once rather than one per submission', () => {
    const errs = validateDetails({ account: 'nope', accountName: '', ird: 'nope', country: 'NZ' })
    expect(errs.map((e) => e.field).sort()).toEqual(['account', 'accountName', 'ird'])
  })
})
