import { describe, expect, it } from 'vitest'
import {
  PASSWORD_PARAMS,
  hashPassword,
  needsRehash,
  verifyAgainstNothing,
  verifyPassword,
  type ScryptParams,
} from './password'

/**
 * How a password is kept.
 *
 * Written before the implementation, because this is the file that decides
 * what a stolen database backup is worth. The rule that matters most: **the
 * password itself is never stored**, only a slow, salted, memory-hard hash of
 * it, so a copy of the User table does not hand anybody a way in.
 *
 * Most tests run on deliberately cheap parameters. The real ones take a
 * fifth of a second a go, which is the point of them and no use in a test
 * suite of five hundred cases. One test checks the real ones meet the floor.
 */

const CHEAP: ScryptParams = { ln: 10, r: 8, p: 1 }

describe('hashPassword', () => {
  it('never contains the password', async () => {
    const stored = await hashPassword('the bar closes at one', CHEAP)
    expect(stored).not.toContain('the bar closes at one')
    expect(stored).not.toContain(Buffer.from('the bar closes at one').toString('base64'))
  })

  it('says how it was made, so the cost can be raised later without locking anybody out', async () => {
    const stored = await hashPassword('the bar closes at one', CHEAP)
    expect(stored).toMatch(/^\$scrypt\$ln=10,r=8,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/)
  })

  it('salts every hash, so two people with one password do not share a hash', async () => {
    const a = await hashPassword('the bar closes at one', CHEAP)
    const b = await hashPassword('the bar closes at one', CHEAP)
    expect(a).not.toBe(b)
  })
})

describe('verifyPassword', () => {
  it('accepts the password it was made from', async () => {
    const stored = await hashPassword('the bar closes at one', CHEAP)
    expect(await verifyPassword('the bar closes at one', stored)).toBe(true)
  })

  it('refuses anything else', async () => {
    const stored = await hashPassword('the bar closes at one', CHEAP)
    expect(await verifyPassword('the bar closes at two', stored)).toBe(false)
    expect(await verifyPassword('', stored)).toBe(false)
  })

  it('is case sensitive', async () => {
    const stored = await hashPassword('The Bar Closes At One', CHEAP)
    expect(await verifyPassword('the bar closes at one', stored)).toBe(false)
  })

  it('does not trim — a space somebody typed on purpose is part of the password', async () => {
    const stored = await hashPassword(' the bar closes at one ', CHEAP)
    expect(await verifyPassword('the bar closes at one', stored)).toBe(false)
    expect(await verifyPassword(' the bar closes at one ', stored)).toBe(true)
  })

  /**
   * "é" can arrive as one code point or as "e" plus a combining accent,
   * depending on the keyboard and the device. The same person typing the
   * same password on a phone and on the bar laptop must get in on both.
   */
  it('treats the same characters typed on different devices as the same password', async () => {
    const composed = 'kōrero at the café tonight'.normalize('NFC')
    const decomposed = composed.normalize('NFD')
    expect(composed).not.toBe(decomposed)

    const stored = await hashPassword(composed, CHEAP)
    expect(await verifyPassword(decomposed, stored)).toBe(true)
  })

  it('checks against the parameters recorded in the hash, not the current ones', async () => {
    const stored = await hashPassword('the bar closes at one', { ln: 11, r: 8, p: 1 })
    expect(await verifyPassword('the bar closes at one', stored)).toBe(true)
  })

  /**
   * A hash that cannot be read is not a wrong password. Treating it as one
   * would lock somebody out and say nothing about why — the fault is ours
   * and it should be loud.
   */
  it('throws on a stored value that is not a hash it made', async () => {
    await expect(verifyPassword('anything', 'hunter2')).rejects.toThrow(/hash/i)
    await expect(verifyPassword('anything', '$bcrypt$whatever')).rejects.toThrow(/hash/i)
  })

  /**
   * A row edited to ask for 2^30 iterations would make every sign-in attempt
   * allocate a gigabyte. The stored parameters are data, and data from the
   * database is not trusted to size an allocation.
   */
  it('refuses stored parameters far outside anything it would have written', async () => {
    const stored = await hashPassword('the bar closes at one', CHEAP)
    const hostile = stored.replace('ln=10', 'ln=30')
    await expect(verifyPassword('the bar closes at one', hostile)).rejects.toThrow(/hash/i)
  })
})

describe('needsRehash', () => {
  it('is false for a hash made with the current parameters', async () => {
    const stored = await hashPassword('the bar closes at one', CHEAP)
    expect(needsRehash(stored, CHEAP)).toBe(false)
  })

  it('is true once the house raises the cost, so the next sign-in upgrades the hash', async () => {
    const stored = await hashPassword('the bar closes at one', CHEAP)
    expect(needsRehash(stored, { ...CHEAP, ln: 11 })).toBe(true)
    expect(needsRehash(stored, { ...CHEAP, p: 2 })).toBe(true)
  })

  it('does not downgrade a hash that is already stronger than current', async () => {
    const stored = await hashPassword('the bar closes at one', { ln: 11, r: 8, p: 1 })
    expect(needsRehash(stored, CHEAP)).toBe(false)
  })
})

describe('verifyAgainstNothing', () => {
  /**
   * An address with no account must take as long to refuse as a wrong
   * password on a real one. Otherwise the response time answers the question
   * the error message was careful not to: whether that address is on file.
   */
  it('always says no', async () => {
    expect(await verifyAgainstNothing('the bar closes at one', CHEAP)).toBe(false)
    expect(await verifyAgainstNothing('', CHEAP)).toBe(false)
  })
})

describe('PASSWORD_PARAMS', () => {
  /**
   * OWASP's floor for scrypt when Argon2id is not available is N=2^17, r=8,
   * p=1, or an equivalent trade of memory for parallelism: 2^16/r8/p2,
   * 2^15/r8/p3, 2^14/r8/p5, 2^13/r8/p10. Argon2id would need a native
   * dependency on the Node 22 this project runs on; scrypt is in node:crypto.
   */
  it('meets the OWASP floor for scrypt', () => {
    const floor: Record<number, number> = { 17: 1, 16: 2, 15: 3, 14: 5, 13: 10 }
    const { ln, r, p } = PASSWORD_PARAMS
    expect(r).toBeGreaterThanOrEqual(8)
    expect(ln).toBeGreaterThanOrEqual(13)
    expect(p).toBeGreaterThanOrEqual(floor[Math.min(ln, 17)])
  })

  it('round-trips at full cost', async () => {
    const stored = await hashPassword('the bar closes at one')
    expect(await verifyPassword('the bar closes at one', stored)).toBe(true)
    expect(needsRehash(stored)).toBe(false)
  })
})
