import { describe, expect, it } from 'vitest'
import { GRANT_TTL_DAYS, grantStatus, hashToken, mintToken, tokenLooksValid } from './grants'

/**
 * The links sent to people who have no account.
 *
 * A touring act gets one of these by email and puts their own bank details in
 * on the other side of it. It is therefore the single most attackable surface
 * in the product, and the only credential in it that is not a password.
 */

describe('minting', () => {
  it('never mints the same token twice', () => {
    expect(mintToken()).not.toBe(mintToken())
  })

  it('is long enough not to be guessed', () => {
    // 32 bytes, base64url — brute force is not the attack to worry about.
    expect(mintToken().length).toBeGreaterThanOrEqual(43)
  })

  it('is URL-safe, because it travels as a path segment', () => {
    for (let i = 0; i < 50; i++) expect(mintToken()).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('hashing', () => {
  it('is stable, so a link keeps working', () => {
    const t = mintToken()
    expect(hashToken(t)).toBe(hashToken(t))
  })

  it('differs for different tokens', () => {
    expect(hashToken(mintToken())).not.toBe(hashToken(mintToken()))
  })

  it('does not contain the token — the database must not hand out working links', () => {
    const t = mintToken()
    expect(hashToken(t)).not.toContain(t)
    expect(t).not.toContain(hashToken(t))
  })
})

describe('tokenLooksValid', () => {
  it('accepts what mintToken produces', () => {
    expect(tokenLooksValid(mintToken())).toBe(true)
  })

  it('rejects the shapes that arrive when somebody is poking at the route', () => {
    expect(tokenLooksValid('')).toBe(false)
    expect(tokenLooksValid('short')).toBe(false)
    expect(tokenLooksValid('../../etc/passwd')).toBe(false)
    expect(tokenLooksValid('a'.repeat(500))).toBe(false)
    expect(tokenLooksValid('has spaces in it aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false)
  })
})

describe('grantStatus', () => {
  const now = new Date('2026-09-01T00:00:00Z')
  const future = new Date('2026-09-10T00:00:00Z')
  const past = new Date('2026-08-20T00:00:00Z')

  it('is open for an unused grant that has not expired', () => {
    expect(grantStatus({ expires: future, usedAt: null, revokedAt: null }, now)).toBe('open')
  })

  it('stays open after a first use, so a typo can be corrected', () => {
    expect(grantStatus({ expires: future, usedAt: past, revokedAt: null }, now)).toBe('open')
  })

  it('is expired past its date', () => {
    expect(grantStatus({ expires: past, usedAt: null, revokedAt: null }, now)).toBe('expired')
  })

  it('is revoked once revoked, even if it has not expired', () => {
    expect(grantStatus({ expires: future, usedAt: null, revokedAt: past }, now)).toBe('revoked')
  })

  it('reports revoked ahead of expired — it is the more important fact', () => {
    expect(grantStatus({ expires: past, usedAt: null, revokedAt: past }, now)).toBe('revoked')
  })

  it('treats the expiry instant itself as expired', () => {
    expect(grantStatus({ expires: now, usedAt: null, revokedAt: null }, now)).toBe('expired')
  })

  it('expires by default within a fortnight — a link should not outlive the booking', () => {
    expect(GRANT_TTL_DAYS).toBeLessThanOrEqual(14)
  })
})
