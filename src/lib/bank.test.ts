import { describe, expect, it } from 'vitest'
import {
  formatAccount,
  irdTail,
  isBankAccount,
  isIrdNumber,
  normaliseAccount,
  normaliseIrd,
  accountTail,
  withholdingRate,
} from './bank'

/**
 * These are the checks that stand between a typed-in account number and a
 * payment run. They are pure so they can be tested without a database, and
 * they are tested first because getting them wrong pays the wrong person.
 */

describe('NZ bank account numbers', () => {
  it('accepts the standard bank-branch-account-suffix form', () => {
    expect(isBankAccount('01-0123-0123456-00')).toBe(true)
    expect(isBankAccount('12-3141-0123456-000')).toBe(true)
  })

  it('accepts a three-digit suffix, which some banks still issue', () => {
    expect(normaliseAccount('03-1587-0034982-025')).toBe('0315870034982025')
  })

  it('takes the separators people actually type, or none at all', () => {
    const want = '0101230123456000'
    expect(normaliseAccount('01-0123-0123456-000')).toBe(want)
    expect(normaliseAccount('01 0123 0123456 000')).toBe(want)
    expect(normaliseAccount('0101230123456000')).toBe(want)
    expect(normaliseAccount('  01-0123-0123456-000  ')).toBe(want)
  })

  it('pads a two-digit suffix to three so two spellings of one account match', () => {
    expect(normaliseAccount('01-0123-0123456-00')).toBe(normaliseAccount('01-0123-0123456-000'))
  })

  it('rejects a number that is too short to be an account', () => {
    expect(isBankAccount('01-0123-0123456')).toBe(false)
    expect(isBankAccount('123')).toBe(false)
    expect(isBankAccount('')).toBe(false)
  })

  it('rejects letters — an IBAN or a typed-in bank name is not an NZ account', () => {
    expect(isBankAccount('GB33BUKB20201555555555')).toBe(false)
    expect(isBankAccount('ASB main account')).toBe(false)
  })

  it('rejects an unallocated bank prefix', () => {
    // 00 and 99 are not issued to any registered bank.
    expect(isBankAccount('00-0123-0123456-000')).toBe(false)
    expect(isBankAccount('99-0123-0123456-000')).toBe(false)
  })

  it('renders back to the hyphenated form a person recognises', () => {
    expect(formatAccount('0101230123456000')).toBe('01-0123-0123456-000')
  })

  it('round-trips: normalise then format is stable', () => {
    const typed = '02 0500 0086542 001'
    expect(formatAccount(normaliseAccount(typed))).toBe('02-0500-0086542-001')
  })
})

describe('the tail kept in the clear', () => {
  /**
   * Finance needs to tell two accounts apart on screen without either one
   * being decrypted. Three digits does that; more of them starts to rebuild
   * the number in the database it was encrypted to stay out of.
   */
  it('is the last three digits of the account body, not of the suffix', () => {
    expect(accountTail('0101230123456000')).toBe('456')
  })

  it('is stable across the two spellings of the same account', () => {
    expect(accountTail(normaliseAccount('01-0123-0123456-00'))).toBe(
      accountTail(normaliseAccount('01-0123-0123456-000')),
    )
  })

  it('never returns the whole number for a short input', () => {
    expect(accountTail('12')).toBe('')
  })

  it('gives the last three of an IRD number', () => {
    expect(irdTail('049091850')).toBe('850')
  })
})

describe('IRD numbers', () => {
  /**
   * The check-digit algorithm is IRD's published modulus-11. The vectors
   * below are the ones IRD publishes as valid test numbers — if this ever
   * fails, check them against IRD's spec before changing the algorithm.
   */
  it('accepts published valid test numbers', () => {
    expect(isIrdNumber('49091850')).toBe(true)
    expect(isIrdNumber('35901981')).toBe(true)
    expect(isIrdNumber('49098576')).toBe(true)
  })

  it('accepts them written with the separators people type', () => {
    expect(isIrdNumber('049-091-850')).toBe(true)
    expect(isIrdNumber('49 091 850')).toBe(true)
  })

  it('normalises to nine digits so one number has one spelling', () => {
    expect(normaliseIrd('49-091-850')).toBe('049091850')
    expect(normaliseIrd('049091850')).toBe('049091850')
  })

  it('rejects a number whose check digit does not hold', () => {
    expect(isIrdNumber('49091851')).toBe(false)
    expect(isIrdNumber('12345678')).toBe(false)
  })

  it('rejects numbers outside the issued range', () => {
    expect(isIrdNumber('9999999')).toBe(false)
    expect(isIrdNumber('0')).toBe(false)
    expect(isIrdNumber('')).toBe(false)
  })

  it('rejects letters', () => {
    expect(isIrdNumber('49091850A')).toBe(false)
  })
})

describe('withholding for non-resident acts', () => {
  /**
   * A touring act without a certificate of exemption has tax withheld at
   * source. Getting this wrong underpays the artist or leaves XCHC carrying
   * the liability, so the default is the *safe* one: withhold.
   */
  it('does not withhold from an NZ-resident payee', () => {
    expect(withholdingRate({ country: 'NZ', nrctRate: null, exempt: false })).toBe(0)
  })

  it('withholds at the standard non-resident rate when none is agreed', () => {
    expect(withholdingRate({ country: 'AU', nrctRate: null, exempt: false })).toBe(0.15)
  })

  it('uses an agreed rate when IRD has issued one', () => {
    expect(withholdingRate({ country: 'AU', nrctRate: 0.1, exempt: false })).toBe(0.1)
  })

  it('withholds nothing when the act holds a certificate of exemption', () => {
    expect(withholdingRate({ country: 'AU', nrctRate: 0.15, exempt: true })).toBe(0)
  })

  it('treats an unknown country as non-resident rather than as NZ', () => {
    expect(withholdingRate({ country: null, nrctRate: null, exempt: false })).toBe(0.15)
  })
})
