import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Where an emailed link lands.
 *
 * Opening the link does nothing by itself. The page it reaches has a button,
 * and pressing that is what spends the link: mail scanners that open every
 * link in a message to check it would otherwise spend a sign-in link before
 * the person it was sent to ever saw it.
 */

const authData = {
  previewLink: vi.fn(),
  redeemSignInLink: vi.fn(),
  setPasswordWithLink: vi.fn(),
  recordAuthEvent: vi.fn(),
}
vi.mock('@/lib/auth-data', () => authData)

const auth = { startSession: vi.fn() }
vi.mock('@/lib/auth', () => auth)

const links = { notifyPasswordChanged: vi.fn() }
vi.mock('@/lib/auth-links', () => links)

const password = { hashPassword: vi.fn() }
vi.mock('@/lib/password', () => password)

const afterQueue: (() => unknown)[] = []
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void afterQueue.push(fn) }))

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

const { continueWithLink, setPasswordFromLink } = await import('./actions')

const token = 't'.repeat(43)
const email = 'mere.tapu@xchc.co.nz'

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  for (const group of [authData, auth, links, password]) {
    for (const fn of Object.values(group)) fn.mockReset()
  }
  afterQueue.length = 0
  password.hashPassword.mockResolvedValue('$scrypt$new')
})

describe('continueWithLink', () => {
  it('spends the link and opens an email-link session', async () => {
    authData.redeemSignInLink.mockResolvedValue({ userId: 'u_mere', email })

    await expect(continueWithLink(null, form({ token }))).rejects.toMatchObject({ url: '/' })

    expect(auth.startSession).toHaveBeenCalledWith('u_mere', 'EMAIL_LINK')
    expect(authData.recordAuthEvent).toHaveBeenCalledWith('LINK_SIGN_IN', {
      email,
      userId: 'u_mere',
    })
  })

  it('opens nothing for a link that is spent, expired or for a switched-off account', async () => {
    authData.redeemSignInLink.mockResolvedValue(null)

    const state = await continueWithLink(null, form({ token }))

    expect(state?.error).toMatch(/used|expired/i)
    expect(auth.startSession).not.toHaveBeenCalled()
  })
})

describe('setPasswordFromLink', () => {
  const open = (over = {}) => ({
    purpose: 'RESET',
    state: 'open',
    email,
    names: ['Mere Tapu'],
    hasPassword: true,
    ...over,
  })
  const submit = (pw: string, confirm = pw) =>
    setPasswordFromLink(null, form({ token, password: pw, confirm }))

  it('sets the password, signs them in, and records a reset', async () => {
    authData.previewLink.mockResolvedValue(open())
    authData.setPasswordWithLink.mockResolvedValue({ userId: 'u_mere', email, purpose: 'RESET' })

    await expect(submit('kettle harbour mitten')).rejects.toMatchObject({ url: '/' })

    expect(password.hashPassword).toHaveBeenCalledWith('kettle harbour mitten')
    expect(authData.setPasswordWithLink).toHaveBeenCalledWith(token, '$scrypt$new')
    expect(auth.startSession).toHaveBeenCalledWith('u_mere', 'EMAIL_LINK')
    expect(authData.recordAuthEvent).toHaveBeenCalledWith('PASSWORD_RESET', {
      email,
      userId: 'u_mere',
    })
  })

  it('records a first password from an invitation as set, not reset', async () => {
    authData.previewLink.mockResolvedValue(open({ purpose: 'INVITE', hasPassword: false }))
    authData.setPasswordWithLink.mockResolvedValue({ userId: 'u_mere', email, purpose: 'INVITE' })

    await expect(submit('kettle harbour mitten')).rejects.toBeInstanceOf(RedirectSignal)
    expect(authData.recordAuthEvent).toHaveBeenCalledWith('PASSWORD_SET', {
      email,
      userId: 'u_mere',
    })
  })

  /**
   * If somebody else reset the password, this email is how the owner finds
   * out. A first password from an invitation replaces nothing, so it is not
   * worth an email saying so.
   */
  it('tells the owner when a password they had was replaced, and only then', async () => {
    authData.setPasswordWithLink.mockResolvedValue({ userId: 'u_mere', email, purpose: 'RESET' })

    authData.previewLink.mockResolvedValue(open({ hasPassword: true }))
    await submit('kettle harbour mitten').catch(() => {})
    await Promise.all(afterQueue.map((fn) => fn()))
    expect(links.notifyPasswordChanged).toHaveBeenCalledWith(email, expect.any(Date))

    links.notifyPasswordChanged.mockClear()
    afterQueue.length = 0
    authData.previewLink.mockResolvedValue(open({ purpose: 'INVITE', hasPassword: false }))
    await submit('kettle harbour mitten').catch(() => {})
    await Promise.all(afterQueue.map((fn) => fn()))
    expect(links.notifyPasswordChanged).not.toHaveBeenCalled()
  })

  it('does not spend the link when the two passwords differ', async () => {
    authData.previewLink.mockResolvedValue(open())

    const state = await submit('kettle harbour mitten', 'kettle harbour mittens')

    expect(state?.error).toMatch(/match/i)
    expect(authData.setPasswordWithLink).not.toHaveBeenCalled()
  })

  it('does not spend the link on a password the policy refuses, and says why', async () => {
    authData.previewLink.mockResolvedValue(open())

    const state = await submit('short')

    expect(state?.error).toMatch(/15 characters/)
    expect(password.hashPassword).not.toHaveBeenCalled()
    expect(authData.setPasswordWithLink).not.toHaveBeenCalled()
  })

  it('judges the password against this account’s own name and address', async () => {
    authData.previewLink.mockResolvedValue(open())
    const state = await submit('MereTapu2026!!!!')
    expect(state?.error).toMatch(/name|email/i)
  })

  it('will not set a password from a sign-in link', async () => {
    authData.previewLink.mockResolvedValue(open({ purpose: 'SIGN_IN' }))

    const state = await submit('kettle harbour mitten')

    expect(state?.error).toMatch(/link/i)
    expect(authData.setPasswordWithLink).not.toHaveBeenCalled()
  })

  it.each(['used', 'expired', 'inactive'])('refuses a link that is %s', async (s) => {
    authData.previewLink.mockResolvedValue(open({ state: s }))
    expect((await submit('kettle harbour mitten'))?.error).toBeTruthy()
    expect(authData.setPasswordWithLink).not.toHaveBeenCalled()
  })

  it('signs nobody in when another request spent the link first', async () => {
    authData.previewLink.mockResolvedValue(open())
    authData.setPasswordWithLink.mockResolvedValue(null)

    const state = await submit('kettle harbour mitten')

    expect(state?.error).toMatch(/used|expired/i)
    expect(auth.startSession).not.toHaveBeenCalled()
  })
})
