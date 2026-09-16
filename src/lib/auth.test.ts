import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_IDLE_DAYS, SESSION_MAX_DAYS } from './auth-rules'
import { hashToken, mintToken } from './grants'

/**
 * The session cookie.
 *
 * Everything else about who somebody is rests on this: the cookie carries a
 * random token, the database holds its hash, and a request is signed in only
 * while a live row matches. Tested here is the wiring the rules cannot see —
 * which cookie attributes go out, what is looked up, and that nothing is
 * asked of the database for a cookie that is not even shaped like ours.
 */

vi.mock('server-only', () => ({}))
// React's `cache` only memoises inside a server render; here it is the identity.
vi.mock('react', () => ({ cache: <T>(fn: T) => fn }))

const afterQueue: (() => unknown)[] = []
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void afterQueue.push(fn) }))

type Cookie = { name: string; value: string; [k: string]: unknown }
const jar = {
  values: new Map<string, string>(),
  set: vi.fn((name: string | Cookie, value?: string, options?: object) => {
    const c = typeof name === 'string' ? { name, value: value!, ...options } : name
    jar.values.set(c.name, c.value)
  }),
  delete: vi.fn((c: string | Cookie) => jar.values.delete(typeof c === 'string' ? c : c.name)),
  get: (name: string) =>
    jar.values.has(name) ? { name, value: jar.values.get(name)! } : undefined,
}
vi.mock('next/headers', () => ({
  cookies: async () => jar,
  headers: async () => new Headers({ 'user-agent': 'Firefox on the office Mac' }),
}))

const db = {
  session: {
    findUnique: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
  },
  user: { update: vi.fn() },
  $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
}
vi.mock('./db', () => ({ db }))

const auth = await import('./auth')

const DAY = 24 * 3600 * 1000
const now = new Date('2026-09-16T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ now })
  vi.unstubAllEnvs()
  vi.stubEnv('AUTH_URL', 'https://pickle.minim.nz')
  jar.values.clear()
  jar.set.mockClear()
  jar.delete.mockClear()
  afterQueue.length = 0
  for (const fn of Object.values(db.session)) fn.mockReset()
  db.user.update.mockReset()
  db.session.deleteMany.mockResolvedValue({ count: 1 })
})

const COOKIE = '__Host-pickle_session'

describe('startSession', () => {
  it('stores the hash of the token and gives the browser the token', async () => {
    await auth.startSession('u_mere', 'PASSWORD')

    const token = jar.values.get(COOKIE)!
    expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/)
    expect(db.session.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenHash: hashToken(token),
        userId: 'u_mere',
        method: 'PASSWORD',
        userAgent: 'Firefox on the office Mac',
        expires: new Date(now.getTime() + SESSION_MAX_DAYS * DAY),
      }),
    })
    expect(JSON.stringify(db.session.create.mock.calls)).not.toContain(token)
  })

  /**
   * HttpOnly so a script on the page cannot read it; Secure and `__Host-` so
   * it only travels over https and no subdomain can plant one; SameSite=Lax so
   * another site cannot make the browser send it with a form post, while a
   * link from an email still arrives signed in.
   */
  it('sets the cookie so a page script cannot read it and another site cannot send it', async () => {
    await auth.startSession('u_mere', 'PASSWORD')

    expect(jar.set).toHaveBeenCalledWith(
      COOKIE,
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        expires: new Date(now.getTime() + SESSION_MAX_DAYS * DAY),
      }),
    )
  })

  it('uses a plain, non-Secure cookie on the http dev server', async () => {
    vi.stubEnv('AUTH_URL', 'http://localhost:3000')
    await auth.startSession('u_mere', 'EMAIL_LINK')
    expect(jar.set).toHaveBeenCalledWith(
      'pickle_session',
      expect.any(String),
      expect.objectContaining({ secure: false }),
    )
  })

  /** A sign-in is always a new session, never a promotion of one this browser already held. */
  it('ends whatever session this browser held before', async () => {
    const old = mintToken()
    jar.values.set(COOKIE, old)

    await auth.startSession('u_mere', 'PASSWORD')

    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: hashToken(old) } })
    expect(jar.values.get(COOKIE)).not.toBe(old)
  })

  it('stamps the account’s last sign-in', async () => {
    await auth.startSession('u_mere', 'PASSWORD')
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'u_mere' },
      data: { lastSignInAt: now },
    })
  })
})

describe('currentSession', () => {
  const token = mintToken()
  const row = (over: Partial<{ expires: Date; lastSeenAt: Date }> = {}) => ({
    id: 's1',
    userId: 'u_mere',
    method: 'PASSWORD',
    createdAt: new Date(now.getTime() - DAY),
    expires: new Date(now.getTime() + 29 * DAY),
    lastSeenAt: new Date(now.getTime() - 5 * 60_000),
    ...over,
  })

  it('is null with no cookie, without asking the database', async () => {
    expect(await auth.currentSession()).toBeNull()
    expect(db.session.findUnique).not.toHaveBeenCalled()
  })

  it('is null for a cookie not shaped like one of ours, without asking the database', async () => {
    jar.values.set(COOKIE, "' OR 1=1 --")
    expect(await auth.currentSession()).toBeNull()
    expect(db.session.findUnique).not.toHaveBeenCalled()
  })

  it('looks the session up by the hash of the cookie, never the cookie itself', async () => {
    jar.values.set(COOKIE, token)
    db.session.findUnique.mockResolvedValue(row())

    expect(await auth.currentSession()).toEqual({
      id: 's1',
      userId: 'u_mere',
      method: 'PASSWORD',
      createdAt: row().createdAt,
    })
    expect(db.session.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashToken(token) } }),
    )
  })

  it('is null when no session matches — ended in Admin, or signed out elsewhere', async () => {
    jar.values.set(COOKIE, token)
    db.session.findUnique.mockResolvedValue(null)
    expect(await auth.currentSession()).toBeNull()
  })

  it('is null past the hard limit, and clears the dead row away', async () => {
    jar.values.set(COOKIE, token)
    db.session.findUnique.mockResolvedValue(row({ expires: now }))

    expect(await auth.currentSession()).toBeNull()
    await Promise.all(afterQueue.map((fn) => fn()))
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { id: 's1' } })
  })

  it('is null once left unused past the idle limit', async () => {
    jar.values.set(COOKIE, token)
    db.session.findUnique.mockResolvedValue(
      row({ lastSeenAt: new Date(now.getTime() - SESSION_IDLE_DAYS * DAY) }),
    )
    expect(await auth.currentSession()).toBeNull()
  })

  it('records use at most hourly, after the response rather than during it', async () => {
    jar.values.set(COOKIE, token)

    db.session.findUnique.mockResolvedValue(row())
    await auth.currentSession()
    expect(afterQueue).toHaveLength(0)

    db.session.findUnique.mockResolvedValue(
      row({ lastSeenAt: new Date(now.getTime() - 2 * 3600_000) }),
    )
    await auth.currentSession()
    expect(afterQueue).toHaveLength(1)
    await afterQueue[0]()
    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { lastSeenAt: now },
    })
  })
})

describe('endCurrentSession', () => {
  it('deletes the row the cookie matched, so the token is dead even if it was copied', async () => {
    const token = mintToken()
    jar.values.set(COOKIE, token)
    db.session.findUnique.mockResolvedValue({ id: 's1', userId: 'u_mere', user: { email: 'm@x' } })

    expect(await auth.endCurrentSession()).toEqual({ userId: 'u_mere', email: 'm@x' })
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { id: 's1' } })
  })

  /**
   * A browser ignores a Set-Cookie for a `__Host-` name that is not itself
   * Secure with path `/` — including the one that is meant to delete it.
   * Next's plain `delete(name)` sends neither, so the cookie would linger.
   */
  it('clears the cookie with the attributes a __Host- cookie needs to be cleared at all', async () => {
    jar.values.set(COOKIE, mintToken())
    db.session.findUnique.mockResolvedValue(null)

    await auth.endCurrentSession()

    expect(jar.delete).toHaveBeenCalledWith(
      expect.objectContaining({ name: COOKIE, secure: true, path: '/', httpOnly: true }),
    )
  })

  it('still clears a cookie that matched nothing', async () => {
    jar.values.set(COOKIE, 'not-a-token')
    expect(await auth.endCurrentSession()).toBeNull()
    expect(jar.values.has(COOKIE)).toBe(false)
  })
})
