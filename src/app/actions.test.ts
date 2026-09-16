import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Signing out.
 *
 * Until passwords, the sign-out button only cleared the development picker's
 * cookie. A real session survived it: the next page load found the session
 * still there and signed the person straight back in — on a shared bar
 * laptop, as whoever had pressed "sign out". These tests are that bug.
 */

vi.mock('server-only', () => ({}))

const auth = { endCurrentSession: vi.fn(), currentSession: vi.fn() }
vi.mock('@/lib/auth', () => auth)

const authData = { recordAuthEvent: vi.fn() }
vi.mock('@/lib/auth-data', () => authData)

vi.mock('@/lib/db', () => ({ db: { user: { findFirst: vi.fn() } } }))

const jar = { delete: vi.fn(), set: vi.fn() }
vi.mock('next/headers', () => ({ cookies: async () => jar }))

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`)
  }
}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url)
  },
}))

const { signOut, signInAs } = await import('./actions')

beforeEach(() => {
  auth.endCurrentSession.mockReset()
  authData.recordAuthEvent.mockReset()
  jar.delete.mockReset()
  jar.set.mockReset()
})

describe('signInAs — the development role picker', () => {
  const pick = (userId: string) => {
    const fd = new FormData()
    fd.set('userId', userId)
    return signInAs(fd)
  }

  /**
   * A real session always wins over the picker's cookie. Without this,
   * picking a role while signed in for real would appear to do nothing.
   */
  it('ends a real session first, so the role picked is the role you get', async () => {
    const { db } = await import('@/lib/db')
    vi.mocked(db.user.findFirst).mockResolvedValue({ id: 'mt' } as never)

    await expect(pick('mt')).rejects.toMatchObject({ url: '/' })

    expect(auth.endCurrentSession).toHaveBeenCalled()
    expect(jar.set).toHaveBeenCalledWith('pickle_uid', 'mt', expect.any(Object))
  })

  /**
   * The cookie is already ignored in production (`stubAllowed`), but the
   * action is a POST endpoint anybody can call. It should do nothing there
   * rather than rely on the cookie being ignored later.
   */
  it('does nothing at all in production', async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const prod = await import('./actions')
      const fd = new FormData()
      fd.set('userId', 'mt')

      await expect(prod.signInAs(fd)).rejects.toMatchObject({ url: '/sign-in' })
      expect(jar.set).not.toHaveBeenCalled()
      expect(auth.endCurrentSession).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('signOut', () => {
  it('ends the real session, not only the development cookie', async () => {
    auth.endCurrentSession.mockResolvedValue({ userId: 'u_mere', email: 'mere.tapu@xchc.co.nz' })

    await expect(signOut()).rejects.toMatchObject({ url: '/sign-in' })

    expect(auth.endCurrentSession).toHaveBeenCalledOnce()
    expect(authData.recordAuthEvent).toHaveBeenCalledWith('SIGNED_OUT', {
      email: 'mere.tapu@xchc.co.nz',
      userId: 'u_mere',
    })
  })

  it('clears the development picker’s cookie as well', async () => {
    auth.endCurrentSession.mockResolvedValue(null)
    await expect(signOut()).rejects.toBeInstanceOf(RedirectSignal)
    expect(jar.delete).toHaveBeenCalledWith('pickle_uid')
  })

  it('records nothing when there was no session to end', async () => {
    auth.endCurrentSession.mockResolvedValue(null)
    await expect(signOut()).rejects.toBeInstanceOf(RedirectSignal)
    expect(authData.recordAuthEvent).not.toHaveBeenCalled()
  })
})
