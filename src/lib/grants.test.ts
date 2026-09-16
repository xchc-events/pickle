import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

// ------------------------------------------------------------------ issuing ---

/**
 * `issueGrant`, against a stand-in database.
 *
 * The link's address comes from configuration — see `linkBase` — and in
 * production with nothing configured there is no safe address to build it on.
 * The old fallback handed the coordinator http://localhost:3000/g/…, which
 * copies and pastes like any other link and is dead to the act who opens it.
 * So issueGrant refuses instead, and refuses before minting: a grant nobody
 * can follow is still a live credential to a payment form.
 *
 * CI sets AUTH_URL for the whole job, so every case here sets it, or unsets
 * it, for itself.
 */

vi.mock('server-only', () => ({}))

const accessGrant = { create: vi.fn() }
vi.mock('./db', () => ({ db: { accessGrant } }))

const { NO_LINK_ADDRESS, issueGrant } = await import('./grants-data')

describe('issueGrant', () => {
  const now = new Date('2026-09-16T12:00:00Z')
  const issue = () => issueGrant('payee_slow_fold', 'BOTH', 'evt_slow_fold', 'person_mere', now)
  const created = () => accessGrant.create.mock.calls[0][0].data

  beforeEach(() => {
    accessGrant.create.mockReset().mockResolvedValue({})
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('AUTH_URL', 'https://pickle.minim.nz')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('points the link at the configured address', async () => {
    const grant = await issue()
    expect(grant?.url).toMatch(/^https:\/\/pickle\.minim\.nz\/g\/[A-Za-z0-9_-]{43,}$/)
  })

  it('does not double the slash when the address is configured with one', async () => {
    vi.stubEnv('AUTH_URL', 'https://pickle.minim.nz/')
    const grant = await issue()
    expect(grant?.url).toMatch(/^https:\/\/pickle\.minim\.nz\/g\/[^/]+$/)
  })

  it('stores only the hash of the token it hands out', async () => {
    const grant = await issue()
    const token = grant!.url.split('/').pop()!

    expect(tokenLooksValid(token)).toBe(true)
    expect(accessGrant.create).toHaveBeenCalledTimes(1)
    expect(created().tokenHash).toBe(hashToken(token))
    expect(JSON.stringify(accessGrant.create.mock.calls)).not.toContain(token)
  })

  it('records who the link is for, what it opens, and who issued it', async () => {
    await issue()
    expect(created()).toMatchObject({
      scope: 'BOTH',
      payeeId: 'payee_slow_fold',
      eventId: 'evt_slow_fold',
      createdById: 'person_mere',
    })
  })

  it(`expires ${GRANT_TTL_DAYS} days after it is issued`, async () => {
    const expires = new Date(now.getTime() + GRANT_TTL_DAYS * 24 * 60 * 60 * 1000)
    const grant = await issue()

    expect(grant?.expires).toEqual(expires)
    expect(created().expires).toEqual(expires)
  })

  it('falls back to the dev server outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AUTH_URL', undefined)
    const grant = await issue()
    expect(grant?.url).toMatch(/^http:\/\/localhost:3000\/g\/[A-Za-z0-9_-]{43,}$/)
  })

  describe('in production with no address configured', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    it.each([
      ['unset', undefined],
      ['empty', ''],
      ['only spaces', '   '],
    ])(
      'refuses when AUTH_URL is %s, rather than hand out a link to localhost',
      async (_, value) => {
        vi.stubEnv('AUTH_URL', value)
        expect(await issue()).toBeNull()
      },
    )

    it('mints nothing, so no live token exists that nobody can use', async () => {
      vi.stubEnv('AUTH_URL', undefined)
      await issue()
      expect(accessGrant.create).not.toHaveBeenCalled()
    })

    it('says why in the server log, naming the setting to fix', async () => {
      vi.stubEnv('AUTH_URL', undefined)
      await issue()
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('AUTH_URL'))
    })
  })
})

describe('NO_LINK_ADDRESS', () => {
  /** What the coordinator reads when issueGrant refuses. Tech and Finance both show it. */
  it('says plainly that links cannot be issued until AUTH_URL is set', () => {
    expect(NO_LINK_ADDRESS).toMatch(/links cannot be issued/i)
    expect(NO_LINK_ADDRESS).toMatch(/until AUTH_URL is set/)
  })

  it('says that nothing was made, so nobody goes looking for a link', () => {
    expect(NO_LINK_ADDRESS).toMatch(/no link was made/i)
  })
})
