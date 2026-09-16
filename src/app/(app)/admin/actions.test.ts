import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Admin's hold over other people's access.
 *
 * Covered here are the actions that touch credentials and sessions — added
 * with passwords — and the switch-off that had to learn about links. Each one
 * is administrator-only, re-checked inside the action rather than trusted
 * from the page that drew the button.
 */

const sione = { id: 'u_sione', role: 'ADMIN', external: false, sessionId: 's1' }
const permissions = { requireModule: vi.fn() }
vi.mock('@/lib/permissions', () => permissions)

const db = {
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  session: { deleteMany: vi.fn() },
  authToken: { deleteMany: vi.fn() },
  $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
}
vi.mock('@/lib/db', () => ({ db }))

const links = { emailLink: vi.fn() }
vi.mock('@/lib/auth-links', () => links)

const authData = { endSessions: vi.fn(), recordAuthEvent: vi.fn() }
vi.mock('@/lib/auth-data', () => authData)

vi.mock('next/cache', () => ({ refresh: vi.fn() }))

const actions = await import('./actions')

const mere = {
  id: 'u_mere',
  email: 'mere.tapu@xchc.co.nz',
  name: 'Mere Tapu',
  role: 'COORDINATOR',
  active: true,
  passwordHash: null,
}

beforeEach(() => {
  permissions.requireModule.mockReset().mockResolvedValue({ user: sione, modules: ['admin'] })
  for (const table of [db.user, db.session, db.authToken]) {
    for (const fn of Object.values(table)) fn.mockReset()
  }
  for (const fn of [...Object.values(links), ...Object.values(authData)]) fn.mockReset()
  db.user.findUnique.mockResolvedValue(mere)
  db.session.deleteMany.mockResolvedValue({ count: 0 })
  db.authToken.deleteMany.mockResolvedValue({ count: 0 })
  links.emailLink.mockResolvedValue('sent')
})

describe('sendInvite', () => {
  it('emails an invitation, with the administrator recorded as the sender', async () => {
    const said = await actions.sendInvite('u_mere')

    expect(links.emailLink).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u_mere', email: mere.email }),
      'INVITE',
      'u_sione',
    )
    expect(said.kind).toBe('good')
    expect(said.text).toContain(mere.email)
  })

  it('is for administrators only', async () => {
    permissions.requireModule.mockResolvedValue({ user: { ...sione, role: 'COORDINATOR' } })
    expect((await actions.sendInvite('u_mere')).kind).toBe('stop')
    expect(links.emailLink).not.toHaveBeenCalled()
  })

  it('will not invite a switched-off account — the link would not work', async () => {
    db.user.findUnique.mockResolvedValue({ ...mere, active: false })
    expect((await actions.sendInvite('u_mere')).kind).toBe('stop')
    expect(links.emailLink).not.toHaveBeenCalled()
  })

  /**
   * Somebody with a password resets it themselves from the sign-in page. An
   * administrator sending week-long password links to an account that
   * already has one would be a quieter way to take it over than switching it
   * off, so Admin does not offer it.
   */
  it('will not send a password link to somebody who already has a password', async () => {
    db.user.findUnique.mockResolvedValue({ ...mere, passwordHash: '$scrypt$x' })
    const said = await actions.sendInvite('u_mere')
    expect(said.kind).toBe('warn')
    expect(said.text).toMatch(/already has a password/i)
    expect(links.emailLink).not.toHaveBeenCalled()
  })

  it('says when one went out a moment ago', async () => {
    links.emailLink.mockResolvedValue('cooling')
    expect((await actions.sendInvite('u_mere')).kind).toBe('warn')
  })

  it('says plainly when the mail service refused', async () => {
    links.emailLink.mockRejectedValue(new Error('Resend refused the message: domain not verified'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const said = await actions.sendInvite('u_mere')
    expect(said.kind).toBe('stop')
    expect(said.text).toMatch(/not sent|did not go/i)
    log.mockRestore()
  })
})

describe('endSessionsFor', () => {
  it('signs somebody out everywhere, recording which administrator did it', async () => {
    authData.endSessions.mockResolvedValue(3)

    const said = await actions.endSessionsFor('u_mere')

    expect(authData.endSessions).toHaveBeenCalledWith('u_mere')
    expect(authData.recordAuthEvent).toHaveBeenCalledWith('SESSIONS_ENDED', {
      email: mere.email,
      userId: 'u_mere',
      actorId: 'u_sione',
    })
    expect(said.text).toMatch(/3/)
  })

  it('is for administrators only', async () => {
    permissions.requireModule.mockResolvedValue({ user: { ...sione, role: 'TECH' } })
    expect((await actions.endSessionsFor('u_mere')).kind).toBe('stop')
    expect(authData.endSessions).not.toHaveBeenCalled()
  })

  it('sends an administrator to their own account page rather than signing themselves out here', async () => {
    const said = await actions.endSessionsFor('u_sione')
    expect(said.text).toMatch(/account/i)
    expect(authData.endSessions).not.toHaveBeenCalled()
  })
})

describe('addUser', () => {
  const form = (fields: Record<string, string>) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.set(k, v)
    return fd
  }

  beforeEach(() => {
    db.user.findUnique.mockResolvedValue(null)
    db.user.findFirst.mockResolvedValue(null)
    db.user.create.mockResolvedValue({ ...mere })
  })

  it('invites the new account when asked to', async () => {
    const said = await actions.addUser(
      form({ email: mere.email, name: 'Mere Tapu', role: 'COORDINATOR', invite: 'on' }),
    )

    expect(links.emailLink).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u_mere' }),
      'INVITE',
      'u_sione',
    )
    expect(said.text).toMatch(/invitation/i)
  })

  it('sends nothing when not asked to', async () => {
    await actions.addUser(form({ email: mere.email, name: 'Mere Tapu', role: 'COORDINATOR' }))
    expect(links.emailLink).not.toHaveBeenCalled()
  })

  it('keeps the account when the invitation fails, and says so', async () => {
    links.emailLink.mockRejectedValue(new Error('Resend refused the message'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    const said = await actions.addUser(
      form({ email: mere.email, name: 'Mere Tapu', role: 'COORDINATOR', invite: 'on' }),
    )

    expect(db.user.create).toHaveBeenCalled()
    expect(said.kind).toBe('warn')
    log.mockRestore()
  })
})

describe('setActive', () => {
  it('ends their sessions and kills any link they have not used yet when switching somebody off', async () => {
    db.user.count.mockResolvedValue(2)
    db.user.findUnique.mockResolvedValue({ ...mere, role: 'COORDINATOR', active: true })

    await actions.setActive('u_mere', false)

    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u_mere' } })
    expect(db.authToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u_mere', usedAt: null },
    })
  })
})
