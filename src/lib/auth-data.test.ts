import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FREE_ATTEMPTS, TOKEN_TTL_SECONDS } from './auth-rules'
import { hashToken } from './grants'

/**
 * The database half of signing in.
 *
 * The rules in auth-rules.ts decide; this file does what they decided, against
 * the tables. What is tested here is the part a rule cannot promise on its
 * own: that a throttled attempt never reaches the password check, that an
 * address with no account does the same work as a wrong password, that a
 * link is spent exactly once, and that setting a password ends every session
 * the old one was holding open.
 *
 * The database is a stand-in, so these are statements about the queries this
 * file sends — the `where` clauses are the promises, and they are what is
 * asserted.
 */

vi.mock('server-only', () => ({}))

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({
      'user-agent': 'Safari on the bar laptop',
      'x-forwarded-for': '203.0.113.9, 10.0.0.1',
    }),
}))

const password = {
  verifyPassword: vi.fn(),
  verifyAgainstNothing: vi.fn(),
  needsRehash: vi.fn(),
  hashPassword: vi.fn(),
}
vi.mock('./password', () => password)

const db = {
  authEvent: { findMany: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn(), update: vi.fn() },
  authToken: {
    deleteMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  session: { deleteMany: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(),
}
vi.mock('./db', () => ({ db }))

const data = await import('./auth-data')

const now = new Date('2026-09-16T12:00:00Z')
const email = 'mere.tapu@xchc.co.nz'

beforeEach(() => {
  vi.unstubAllEnvs()
  for (const fn of [...Object.values(password)]) fn.mockReset()
  for (const table of [db.authEvent, db.user, db.authToken, db.session]) {
    for (const fn of Object.values(table)) fn.mockReset()
  }
  db.$transaction.mockReset().mockImplementation(async (arg: unknown) =>
    // The array form runs each query; the callback form gets the same client.
    typeof arg === 'function' ? arg(db) : Promise.all(arg as Promise<unknown>[]),
  )

  db.authEvent.findMany.mockResolvedValue([])
  db.authEvent.create.mockResolvedValue({})
  password.verifyAgainstNothing.mockResolvedValue(false)
  password.needsRehash.mockReturnValue(false)
})

// ---------------------------------------------------------------- passwords ---

describe('attemptPassword', () => {
  const account = { id: 'u_mere', active: true, passwordHash: '$scrypt$stored' }

  it('checks no password and writes nothing while the address is throttled', async () => {
    db.authEvent.findMany.mockResolvedValue(
      Array.from({ length: FREE_ATTEMPTS }, () => ({ kind: 'PASSWORD_FAILED', at: now })),
    )

    const result = await data.attemptPassword(email, 'kettle harbour mitten', now)

    expect(result).toMatchObject({ ok: false, reason: 'throttled' })
    expect(db.user.findUnique).not.toHaveBeenCalled()
    expect(password.verifyPassword).not.toHaveBeenCalled()
    expect(password.verifyAgainstNothing).not.toHaveBeenCalled()
    expect(db.authEvent.create).not.toHaveBeenCalled()
  })

  it('counts the throttle from password failures and anything that proves the person got in', async () => {
    db.user.findUnique.mockResolvedValue(null)
    await data.attemptPassword(email, 'whatever', now)

    const { where, take } = db.authEvent.findMany.mock.calls[0][0]
    expect(where.email).toBe(email)
    expect(where.kind.in).toEqual(
      expect.arrayContaining([
        'PASSWORD_FAILED',
        'PASSWORD_SIGN_IN',
        'LINK_SIGN_IN',
        'PASSWORD_RESET',
      ]),
    )
    // Asking for links is not getting in, or anybody could clear the throttle
    // on somebody else's address by requesting one.
    expect(where.kind.in).not.toContain('LINK_SENT')
    expect(where.kind.in).not.toContain('RESET_SENT')
    expect(take).toBeGreaterThanOrEqual(100)
  })

  it('refuses an address with no account only after doing the work of a real check', async () => {
    db.user.findUnique.mockResolvedValue(null)

    const result = await data.attemptPassword(email, 'kettle harbour mitten', now)

    expect(result).toEqual({ ok: false, reason: 'wrong' })
    expect(password.verifyAgainstNothing).toHaveBeenCalledOnce()
    expect(db.authEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'PASSWORD_FAILED', email, userId: null }),
    })
  })

  it('refuses an account with no password in exactly the same way', async () => {
    db.user.findUnique.mockResolvedValue({ ...account, passwordHash: null })

    const result = await data.attemptPassword(email, 'kettle harbour mitten', now)

    expect(result).toEqual({ ok: false, reason: 'wrong' })
    expect(password.verifyAgainstNothing).toHaveBeenCalledOnce()
    expect(password.verifyPassword).not.toHaveBeenCalled()
  })

  it('records a wrong password against the address', async () => {
    db.user.findUnique.mockResolvedValue(account)
    password.verifyPassword.mockResolvedValue(false)

    expect(await data.attemptPassword(email, 'not it at all', now)).toEqual({
      ok: false,
      reason: 'wrong',
    })
    expect(db.authEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'PASSWORD_FAILED', email, userId: 'u_mere' }),
    })
  })

  it('never hashes an input too long to be anybody’s password', async () => {
    db.user.findUnique.mockResolvedValue(account)

    const result = await data.attemptPassword(email, 'x'.repeat(100_000), now)

    expect(result).toEqual({ ok: false, reason: 'wrong' })
    expect(password.verifyPassword).not.toHaveBeenCalled()
    const [burned] = password.verifyAgainstNothing.mock.calls[0]
    expect(burned.length).toBeLessThanOrEqual(1024)
  })

  /**
   * Somebody who has left should be told their access ended rather than be
   * told their password is wrong — but only somebody who knows the password
   * gets to learn that the account exists at all.
   */
  it('says an account is switched off only to somebody who knew its password', async () => {
    db.user.findUnique.mockResolvedValue({ ...account, active: false })

    password.verifyPassword.mockResolvedValue(false)
    expect(await data.attemptPassword(email, 'guess', now)).toEqual({ ok: false, reason: 'wrong' })

    password.verifyPassword.mockResolvedValue(true)
    expect(await data.attemptPassword(email, 'kettle harbour mitten', now)).toEqual({
      ok: false,
      reason: 'inactive',
    })
    expect(db.authEvent.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ kind: 'REFUSED_INACTIVE', userId: 'u_mere' }),
    })
  })

  it('lets the right password in, and records it with where it came from', async () => {
    db.user.findUnique.mockResolvedValue(account)
    password.verifyPassword.mockResolvedValue(true)

    expect(await data.attemptPassword(email, 'kettle harbour mitten', now)).toEqual({
      ok: true,
      userId: 'u_mere',
    })
    expect(db.authEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'PASSWORD_SIGN_IN',
        userId: 'u_mere',
        ip: '203.0.113.9',
        userAgent: 'Safari on the bar laptop',
      }),
    })
  })

  it('upgrades a hash made at an older cost on the way in', async () => {
    db.user.findUnique.mockResolvedValue(account)
    password.verifyPassword.mockResolvedValue(true)
    password.needsRehash.mockReturnValue(true)
    password.hashPassword.mockResolvedValue('$scrypt$stronger')

    await data.attemptPassword(email, 'kettle harbour mitten', now)

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'u_mere' },
      data: { passwordHash: '$scrypt$stronger' },
    })
  })
})

// -------------------------------------------------------------------- links ---

describe('issueLink', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_URL', 'https://pickle.minim.nz')
    vi.stubEnv('NODE_ENV', 'production')
  })

  it('stores only the hash of the token it hands out', async () => {
    const link = await data.issueLink('u_mere', 'RESET', now)

    const token = link!.url.split('/').pop()!
    const { data: row } = db.authToken.create.mock.calls[0][0]
    expect(row.tokenHash).toBe(hashToken(token))
    expect(JSON.stringify(db.authToken.create.mock.calls)).not.toContain(token)
  })

  it('points the link at the configured address', async () => {
    const link = await data.issueLink('u_mere', 'SIGN_IN', now)
    expect(link!.url).toMatch(/^https:\/\/pickle\.minim\.nz\/sign-in\/link\/[A-Za-z0-9_-]{43,}$/)
  })

  it('issues nothing in production when there is no address to point a link at', async () => {
    vi.stubEnv('AUTH_URL', '')
    expect(await data.issueLink('u_mere', 'RESET', now)).toBeNull()
    expect(db.authToken.create).not.toHaveBeenCalled()
  })

  it('gives each kind of link its own lifetime', async () => {
    for (const purpose of ['SIGN_IN', 'INVITE', 'RESET'] as const) {
      db.authToken.create.mockClear()
      const link = await data.issueLink('u_mere', purpose, now)
      expect(link!.expires.getTime() - now.getTime()).toBe(TOKEN_TTL_SECONDS[purpose] * 1000)
    }
  })

  /** Only the newest password link works, so an older one found later is useless. */
  it('replaces any unspent password link, whether it was an invitation or a reset', async () => {
    await data.issueLink('u_mere', 'RESET', now)
    expect(db.authToken.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'u_mere',
        OR: [{ purpose: { in: ['INVITE', 'RESET'] }, usedAt: null }, { expires: { lt: now } }],
      },
    })
  })

  it('leaves password links alone when it sends a sign-in link', async () => {
    await data.issueLink('u_mere', 'SIGN_IN', now)
    const { where } = db.authToken.deleteMany.mock.calls[0][0]
    expect(where.OR[0].purpose.in).toEqual(['SIGN_IN'])
  })
})

describe('setPasswordWithLink', () => {
  const token = 'a'.repeat(43)

  beforeEach(() => {
    db.authToken.findUnique.mockResolvedValue({
      purpose: 'RESET',
      userId: 'u_mere',
      user: { email },
    })
  })

  it('spends a link only if it is unused, unexpired, a password link, and its account is on', async () => {
    db.authToken.updateMany.mockResolvedValue({ count: 1 })

    await data.setPasswordWithLink(token, '$scrypt$new', now)

    expect(db.authToken.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: hashToken(token),
        usedAt: null,
        expires: { gt: now },
        purpose: { in: ['INVITE', 'RESET'] },
        user: { active: true },
      },
      data: { usedAt: now },
    })
  })

  /**
   * The spend and the check are one statement, so two browsers opening the
   * same link at the same moment cannot both set a password: one update
   * matches the row, the other matches nothing.
   */
  it('writes nothing when the link was already spent, including by a request that raced it', async () => {
    db.authToken.updateMany.mockResolvedValue({ count: 0 })

    expect(await data.setPasswordWithLink(token, '$scrypt$new', now)).toBeNull()
    expect(db.user.update).not.toHaveBeenCalled()
    expect(db.session.deleteMany).not.toHaveBeenCalled()
  })

  it('ends every session the account had, since the old password may be how they were opened', async () => {
    db.authToken.updateMany.mockResolvedValue({ count: 1 })

    const result = await data.setPasswordWithLink(token, '$scrypt$new', now)

    expect(result).toEqual({ userId: 'u_mere', email, purpose: 'RESET' })
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'u_mere' },
      data: { passwordHash: '$scrypt$new', passwordChangedAt: now },
    })
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u_mere' } })
  })

  it('kills every other unspent link for the account', async () => {
    db.authToken.updateMany.mockResolvedValue({ count: 1 })

    await data.setPasswordWithLink(token, '$scrypt$new', now)

    expect(db.authToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u_mere', usedAt: null },
    })
  })

  it('does it all in one transaction', async () => {
    db.authToken.updateMany.mockResolvedValue({ count: 1 })
    await data.setPasswordWithLink(token, '$scrypt$new', now)
    expect(db.$transaction).toHaveBeenCalledOnce()
  })

  it('does not touch the database for something that is not shaped like a token', async () => {
    expect(await data.setPasswordWithLink('../../etc', '$scrypt$new', now)).toBeNull()
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe('redeemSignInLink', () => {
  const token = 'b'.repeat(43)

  it('spends only an unused, unexpired sign-in link for an account that is on', async () => {
    db.authToken.updateMany.mockResolvedValue({ count: 1 })
    db.authToken.findUnique.mockResolvedValue({ userId: 'u_mere', user: { email } })

    expect(await data.redeemSignInLink(token, now)).toEqual({ userId: 'u_mere', email })
    expect(db.authToken.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: hashToken(token),
        usedAt: null,
        expires: { gt: now },
        purpose: 'SIGN_IN',
        user: { active: true },
      },
      data: { usedAt: now },
    })
  })

  it('is null for a link that has been spent', async () => {
    db.authToken.updateMany.mockResolvedValue({ count: 0 })
    expect(await data.redeemSignInLink(token, now)).toBeNull()
  })
})

// ----------------------------------------------------------------- sessions ---

describe('replacePassword', () => {
  it('keeps the session that made the change and ends every other', async () => {
    await data.replacePassword('u_mere', '$scrypt$new', 's_here', now)

    expect(db.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u_mere', id: { not: 's_here' } },
    })
    expect(db.authToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u_mere', usedAt: null },
    })
    expect(db.$transaction).toHaveBeenCalledOnce()
  })
})

describe('endSession', () => {
  it('only ends a session that belongs to the person asking', async () => {
    db.session.deleteMany.mockResolvedValue({ count: 0 })

    expect(await data.endSession('u_mere', 's_someone_elses')).toBe(false)
    expect(db.session.deleteMany).toHaveBeenCalledWith({
      where: { id: 's_someone_elses', userId: 'u_mere' },
    })
  })
})

describe('endSessions', () => {
  it('can spare the session doing the asking', async () => {
    db.session.deleteMany.mockResolvedValue({ count: 2 })

    expect(await data.endSessions('u_mere', { except: 's_here' })).toBe(2)
    expect(db.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u_mere', id: { not: 's_here' } },
    })
  })

  it('ends all of them when nothing is spared', async () => {
    db.session.deleteMany.mockResolvedValue({ count: 3 })

    expect(await data.endSessions('u_mere')).toBe(3)
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u_mere' } })
  })
})
