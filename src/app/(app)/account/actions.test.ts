import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FREE_ATTEMPTS } from '@/lib/auth-rules'

/**
 * A person's own password and sessions.
 *
 * Every one of these belongs to the account doing the asking and nobody else,
 * so the thing most worth testing is that each is scoped to `user.id` — and
 * that changing a password needs the old one, even from inside a session. A
 * session left open on the bar laptop should not be enough to take the
 * account over for good.
 */

const mere = {
  id: 'u_mere',
  email: 'mere.tapu@xchc.co.nz',
  name: 'Mere Tapu',
  sessionId: 's_here',
  authenticated: true,
}
const permissions = { requireUser: vi.fn() }
vi.mock('@/lib/permissions', () => permissions)

const authData = {
  credentialsOf: vi.fn(),
  passwordHistory: vi.fn(),
  recordAuthEvent: vi.fn(),
  replacePassword: vi.fn(),
  endSessions: vi.fn(),
  endSession: vi.fn(),
}
vi.mock('@/lib/auth-data', () => authData)

const links = { emailLink: vi.fn(), notifyPasswordChanged: vi.fn() }
vi.mock('@/lib/auth-links', () => links)

const password = { hashPassword: vi.fn(), verifyPassword: vi.fn() }
vi.mock('@/lib/password', () => password)

vi.mock('next/cache', () => ({ refresh: vi.fn() }))
const afterQueue: (() => unknown)[] = []
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void afterQueue.push(fn) }))

const actions = await import('./actions')

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  for (const group of [permissions, authData, links, password]) {
    for (const fn of Object.values(group)) fn.mockReset()
  }
  afterQueue.length = 0
  permissions.requireUser.mockResolvedValue(mere)
  authData.credentialsOf.mockResolvedValue({
    id: mere.id,
    email: mere.email,
    name: mere.name,
    firstName: null,
    lastName: null,
    passwordHash: '$scrypt$old',
  })
  authData.passwordHistory.mockResolvedValue([])
  password.hashPassword.mockResolvedValue('$scrypt$new')
})

describe('changePassword', () => {
  const change = (current: string, next: string, confirm = next) =>
    actions.changePassword(null, form({ current, password: next, confirm }))

  it('replaces the password, keeping this session and ending the rest', async () => {
    password.verifyPassword.mockResolvedValue(true)

    const state = await change('kettle harbour mitten', 'lantern orchard biscuit')

    expect(state?.done).toMatch(/changed/i)
    expect(authData.replacePassword).toHaveBeenCalledWith(
      'u_mere',
      '$scrypt$new',
      's_here',
      expect.any(Date),
    )
    expect(authData.recordAuthEvent).toHaveBeenCalledWith('PASSWORD_CHANGED', {
      email: mere.email,
      userId: 'u_mere',
    })
  })

  it('emails the owner afterwards', async () => {
    password.verifyPassword.mockResolvedValue(true)
    await change('kettle harbour mitten', 'lantern orchard biscuit')
    await Promise.all(afterQueue.map((fn) => fn()))
    expect(links.notifyPasswordChanged).toHaveBeenCalledWith(mere.email, expect.any(Date))
  })

  it('needs the current password, even from inside a session', async () => {
    password.verifyPassword.mockResolvedValue(false)

    const state = await change('a guess', 'lantern orchard biscuit')

    expect(state?.error).toMatch(/current password/i)
    expect(authData.replacePassword).not.toHaveBeenCalled()
    expect(authData.recordAuthEvent).toHaveBeenCalledWith('PASSWORD_FAILED', {
      email: mere.email,
      userId: 'u_mere',
    })
  })

  it('is throttled like the sign-in form, so a session cannot be used to guess the password', async () => {
    authData.passwordHistory.mockResolvedValue(
      Array.from({ length: FREE_ATTEMPTS }, () => ({ outcome: 'failed', at: new Date() })),
    )

    const state = await change('a guess', 'lantern orchard biscuit')

    expect(state?.error).toMatch(/try again/i)
    expect(password.verifyPassword).not.toHaveBeenCalled()
  })

  it('checks the new password against the policy before spending an attempt on the old one', async () => {
    const state = await change('kettle harbour mitten', 'short')

    expect(state?.error).toMatch(/15 characters/)
    expect(password.verifyPassword).not.toHaveBeenCalled()
    expect(authData.recordAuthEvent).not.toHaveBeenCalled()
  })

  it('refuses when the two new passwords differ', async () => {
    const state = await change(
      'kettle harbour mitten',
      'lantern orchard biscuit',
      'lantern orchard',
    )
    expect(state?.error).toMatch(/match/i)
    expect(authData.replacePassword).not.toHaveBeenCalled()
  })

  it('sends somebody with no password yet to the emailed link instead', async () => {
    authData.credentialsOf.mockResolvedValue({
      ...(await authData.credentialsOf()),
      passwordHash: null,
    })
    const state = await change('', 'lantern orchard biscuit')
    expect(state?.error).toMatch(/no password|link/i)
  })

  /** The dev picker is a cookie with nobody behind it. It has no password to change. */
  it('refuses the development role picker, which has no session', async () => {
    permissions.requireUser.mockResolvedValue({ ...mere, sessionId: null, authenticated: false })
    const state = await change('kettle harbour mitten', 'lantern orchard biscuit')
    expect(state?.error).toMatch(/development/i)
    expect(authData.credentialsOf).not.toHaveBeenCalled()
  })
})

describe('emailMePasswordLink', () => {
  it('sends a reset link to the account’s own address, not one from the form', async () => {
    links.emailLink.mockResolvedValue('sent')

    const said = await actions.emailMePasswordLink()

    expect(links.emailLink).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u_mere', email: mere.email }),
      'RESET',
    )
    expect(said.kind).toBe('good')
    expect(said.text).toContain(mere.email)
  })

  it('says when one went out a moment ago', async () => {
    links.emailLink.mockResolvedValue('cooling')
    expect((await actions.emailMePasswordLink()).kind).toBe('warn')
  })
})

describe('signOutEverywhereElse', () => {
  it('ends every session but this one', async () => {
    authData.endSessions.mockResolvedValue(2)

    const said = await actions.signOutEverywhereElse()

    expect(authData.endSessions).toHaveBeenCalledWith('u_mere', { except: 's_here' })
    expect(said.text).toMatch(/2/)
    expect(authData.recordAuthEvent).toHaveBeenCalledWith('SESSIONS_ENDED', {
      email: mere.email,
      userId: 'u_mere',
    })
  })
})

describe('endOtherSession', () => {
  it('ends a session only within this account', async () => {
    authData.endSession.mockResolvedValue(true)
    await actions.endOtherSession('s_laptop')
    expect(authData.endSession).toHaveBeenCalledWith('u_mere', 's_laptop')
  })

  it('points to Sign out for the session doing the asking', async () => {
    const said = await actions.endOtherSession('s_here')
    expect(said.text).toMatch(/sign out/i)
    expect(authData.endSession).not.toHaveBeenCalled()
  })
})
