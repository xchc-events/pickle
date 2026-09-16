import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The sign-in page's two forms: a password, or a link by email.
 *
 * Whether a password is right, and whether an address is throttled, are
 * decided and tested in auth-data.ts and auth-rules.ts. These tests are about
 * what the page does with the answer — above all, that it says nothing a
 * stranger could use to learn which addresses have accounts.
 */

const authData = { attemptPassword: vi.fn() }
vi.mock('@/lib/auth-data', () => authData)

const auth = { startSession: vi.fn() }
vi.mock('@/lib/auth', () => auth)

const links = { emailLinkQuietly: vi.fn() }
vi.mock('@/lib/auth-links', () => links)

const afterQueue: (() => unknown)[] = []
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void afterQueue.push(fn) }))

/** Stands in for Next's redirect, which signals by throwing. */
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

const { signInWithPassword, requestSignInLink, requestPasswordLink } = await import('./actions')

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  for (const fn of [...Object.values(authData), ...Object.values(auth), ...Object.values(links)]) {
    fn.mockReset()
  }
  afterQueue.length = 0
})

describe('signInWithPassword', () => {
  const submit = (email: string, password: string) =>
    signInWithPassword(null, form({ email, password }))

  it('opens a password session and sends them to the index when the password is right', async () => {
    authData.attemptPassword.mockResolvedValue({ ok: true, userId: 'u_mere' })

    await expect(submit('mere.tapu@xchc.co.nz', 'kettle harbour mitten')).rejects.toMatchObject({
      url: '/',
    })
    expect(auth.startSession).toHaveBeenCalledWith('u_mere', 'PASSWORD')
  })

  /**
   * The data layer already answers `wrong` for an unknown address, an
   * account with no password and a wrong password alike. This is the other
   * half: one sentence for all three.
   */
  it('gives one answer for a wrong password, whoever the address belongs to', async () => {
    authData.attemptPassword.mockResolvedValue({ ok: false, reason: 'wrong' })

    const state = await submit('stranger@example.test', 'kettle harbour mitten')

    expect(state?.error).toMatch(/do not match/i)
    expect(auth.startSession).not.toHaveBeenCalled()
  })

  it('points somebody who has never set a password at the way to get one', async () => {
    authData.attemptPassword.mockResolvedValue({ ok: false, reason: 'wrong' })
    expect((await submit('mere.tapu@xchc.co.nz', 'guess'))?.error).toMatch(/never set|forgotten/i)
  })

  it('tells somebody whose account is switched off that their access has ended', async () => {
    authData.attemptPassword.mockResolvedValue({ ok: false, reason: 'inactive' })
    expect((await submit('left@xchc.co.nz', 'kettle harbour mitten'))?.error).toMatch(
      /switched off/i,
    )
    expect(auth.startSession).not.toHaveBeenCalled()
  })

  it('passes the throttle’s own explanation through, wait and all', async () => {
    authData.attemptPassword.mockResolvedValue({
      ok: false,
      reason: 'throttled',
      verdict: { ok: false, stopped: false, seconds: 240, why: 'Try again in 4 minutes.' },
    })
    expect((await submit('mere.tapu@xchc.co.nz', 'guess'))?.error).toBe('Try again in 4 minutes.')
  })

  it('hands the address back so it need not be typed again — and never the password', async () => {
    authData.attemptPassword.mockResolvedValue({ ok: false, reason: 'wrong' })

    const state = await submit('mere.tapu@xchc.co.nz', 'kettle harbour mitten')

    expect(state?.email).toBe('mere.tapu@xchc.co.nz')
    expect(JSON.stringify(state)).not.toContain('kettle harbour mitten')
  })

  it('normalises the address, so case cannot decide whether somebody gets in', async () => {
    authData.attemptPassword.mockResolvedValue({ ok: false, reason: 'wrong' })
    await submit('  Mere.Tapu@XCHC.co.nz ', 'kettle harbour mitten')
    expect(authData.attemptPassword).toHaveBeenCalledWith(
      'mere.tapu@xchc.co.nz',
      'kettle harbour mitten',
    )
  })

  it('leaves the password exactly as typed — spaces are part of it', async () => {
    authData.attemptPassword.mockResolvedValue({ ok: false, reason: 'wrong' })
    await submit('mere.tapu@xchc.co.nz', ' kettle harbour mitten ')
    expect(authData.attemptPassword.mock.calls[0][1]).toBe(' kettle harbour mitten ')
  })

  it('asks for both fields without checking anything when one is empty', async () => {
    expect((await submit('mere.tapu@xchc.co.nz', ''))?.error).toMatch(/password/i)
    expect((await submit('', 'kettle harbour mitten'))?.error).toMatch(/email/i)
    expect(authData.attemptPassword).not.toHaveBeenCalled()
  })

  it('does not disguise a genuine fault as a wrong password', async () => {
    const boom = new Error('the database fell over')
    authData.attemptPassword.mockRejectedValue(boom)
    await expect(submit('mere.tapu@xchc.co.nz', 'kettle harbour mitten')).rejects.toBe(boom)
  })
})

describe.each([
  ['requestSignInLink', requestSignInLink, 'SIGN_IN'],
  ['requestPasswordLink', requestPasswordLink, 'RESET'],
] as const)('%s', (_, action, purpose) => {
  it('answers the same way whether or not the address has an account', async () => {
    const state = await action(null, form({ email: 'stranger@example.test' }))
    expect(state).toEqual({ sentTo: 'stranger@example.test' })
  })

  /**
   * The lookup, the token and the email all happen after the response. If
   * they happened before it, an address with an account would take a
   * noticeably longer to answer than one without.
   */
  it('does its work after the response has gone, so the timing cannot tell either', async () => {
    await action(null, form({ email: 'mere.tapu@xchc.co.nz' }))
    expect(links.emailLinkQuietly).not.toHaveBeenCalled()

    await Promise.all(afterQueue.map((fn) => fn()))
    expect(links.emailLinkQuietly).toHaveBeenCalledWith('mere.tapu@xchc.co.nz', purpose)
  })

  it('normalises the address', async () => {
    const state = await action(null, form({ email: '  Mere.Tapu@XCHC.co.nz ' }))
    expect(state).toEqual({ sentTo: 'mere.tapu@xchc.co.nz' })
  })

  it('refuses something that is not an email address, without doing anything', async () => {
    const state = await action(null, form({ email: 'mere' }))
    expect(state?.error).toMatch(/email/i)
    expect(afterQueue).toHaveLength(0)
  })
})
