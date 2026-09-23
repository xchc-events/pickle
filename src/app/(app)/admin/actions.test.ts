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
  person: { update: vi.fn() },
  session: { deleteMany: vi.fn() },
  authToken: { deleteMany: vi.fn() },
  venueSpecComponent: { findUnique: vi.fn(), update: vi.fn() },
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
  for (const table of [db.user, db.person, db.session, db.authToken, db.venueSpecComponent]) {
    for (const fn of Object.values(table)) fn.mockReset()
  }
  // Cleared rather than reset: it keeps running the operations it is given.
  db.$transaction.mockClear()
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

  it('switches somebody back on when an administrator asks', async () => {
    db.user.count.mockResolvedValue(1)
    db.user.findUnique.mockResolvedValue({ ...mere, active: false })

    const said = await actions.setActive('u_mere', true)

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'u_mere' },
      data: { active: true },
    })
    expect(said.kind).toBe('good')
  })

  /**
   * Admin is a module, and any role can be granted it. A coordinator given it
   * was already refused switching somebody off, but could switch somebody
   * back on — undoing an administrator's decision from the same page.
   */
  describe('from somebody who can open Admin but is not an administrator', () => {
    beforeEach(() => {
      permissions.requireModule.mockResolvedValue({
        user: { ...sione, id: 'u_tui', role: 'COORDINATOR' },
        modules: ['admin'],
      })
      db.user.count.mockResolvedValue(1)
    })

    it('will not switch an account back on, and writes nothing', async () => {
      db.user.findUnique.mockResolvedValue({ ...mere, active: false })

      const said = await actions.setActive('u_mere', true)

      expect(said.kind).toBe('stop')
      expect(said.text).toMatch(/administrator/i)
      expect(db.user.update).not.toHaveBeenCalled()
      expect(db.$transaction).not.toHaveBeenCalled()
    })

    it('will not switch an account off, and ends nothing', async () => {
      db.user.findUnique.mockResolvedValue({ ...mere, active: true })

      const said = await actions.setActive('u_mere', false)

      expect(said.kind).toBe('stop')
      expect(said.text).toMatch(/administrator/i)
      expect(db.user.update).not.toHaveBeenCalled()
      expect(db.$transaction).not.toHaveBeenCalled()
      expect(db.session.deleteMany).not.toHaveBeenCalled()
      expect(db.authToken.deleteMany).not.toHaveBeenCalled()
    })
  })
})

describe('setEmployment', () => {
  beforeEach(() => {
    db.user.findUnique.mockResolvedValue({ ...mere, role: 'COORDINATOR', personId: 'person_mere' })
  })

  it('sets the linked person’s pay rate, Connor’s 22 Sep 2026 policy', async () => {
    const said = await actions.setEmployment('u_mere', 'EMPLOYEE')

    expect(db.person.update).toHaveBeenCalledWith({
      where: { id: 'person_mere' },
      data: { employment: 'EMPLOYEE' },
    })
    expect(said.kind).toBe('good')
    expect(said.text).toMatch(/employee/i)
    expect(said.text).toMatch(/\$30/)
  })

  it('says the contractor rate when moving somebody the other way', async () => {
    const said = await actions.setEmployment('u_mere', 'CONTRACTOR')
    expect(said.text).toMatch(/contractor/i)
    expect(said.text).toMatch(/\$35/)
  })

  it('is for administrators only', async () => {
    permissions.requireModule.mockResolvedValue({ user: { ...sione, role: 'COORDINATOR' } })
    const said = await actions.setEmployment('u_mere', 'EMPLOYEE')
    expect(said.kind).toBe('stop')
    expect(db.person.update).not.toHaveBeenCalled()
  })

  it('refuses an account with no linked person — there is nothing to set the rate on', async () => {
    db.user.findUnique.mockResolvedValue({ ...mere, role: 'COORDINATOR', personId: null })
    const said = await actions.setEmployment('u_mere', 'EMPLOYEE')
    expect(said.kind).toBe('stop')
    expect(db.person.update).not.toHaveBeenCalled()
  })

  it('refuses an external promoter — pay is a staff concept', async () => {
    db.user.findUnique.mockResolvedValue({ ...mere, role: 'PROMOTER', personId: null })
    const said = await actions.setEmployment('u_mere', 'EMPLOYEE')
    expect(said.kind).toBe('stop')
    expect(db.person.update).not.toHaveBeenCalled()
  })

  it('says when the account does not exist', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const said = await actions.setEmployment('u_ghost', 'EMPLOYEE')
    expect(said.kind).toBe('stop')
    expect(db.person.update).not.toHaveBeenCalled()
  })
})

describe('setPhone', () => {
  /**
   * Contact information for the venue to call a staff member on. `User`
   * already carried `phone` for an external promoter (see `setExternalDetails`
   * above) — this is the same field, editable from the same row, for staff.
   * "We need contact information on these sections... that way external
   * organisers can easily access it." (Connor, 23 Sep 2026.)
   */
  beforeEach(() => {
    db.user.findUnique.mockResolvedValue({ ...mere, role: 'COORDINATOR' })
  })

  it('sets a staff account’s phone number', async () => {
    const said = await actions.setPhone('u_mere', '021 555 0134')

    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'u_mere' },
      data: { phone: '021 555 0134' },
    })
    expect(said.kind).toBe('good')
  })

  it('trims what is typed, and clears the number on an empty string', async () => {
    await actions.setPhone('u_mere', '  021 555 0134  ')
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'u_mere' },
      data: { phone: '021 555 0134' },
    })

    await actions.setPhone('u_mere', '   ')
    expect(db.user.update).toHaveBeenLastCalledWith({
      where: { id: 'u_mere' },
      data: { phone: null },
    })
  })

  it('refuses an external promoter — their phone is set with their other details', async () => {
    db.user.findUnique.mockResolvedValue({ ...mere, role: 'PROMOTER' })
    const said = await actions.setPhone('u_mere', '021 555 0134')
    expect(said.kind).toBe('stop')
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('says when the account does not exist', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const said = await actions.setPhone('u_ghost', '021 555 0134')
    expect(said.kind).toBe('stop')
    expect(db.user.update).not.toHaveBeenCalled()
  })

  it('is not something an external account can do', async () => {
    permissions.requireModule.mockResolvedValue({ user: { ...sione, external: true } })
    const said = await actions.setPhone('u_mere', '021 555 0134')
    expect(said.kind).toBe('stop')
    expect(db.user.update).not.toHaveBeenCalled()
  })
})

/**
 * Editing the venue spec's components.
 *
 * Connor, 23 Sep 2026: X2 — the venue spec is "Edited in Admin ('Venue
 * spec') by administrators." Content and whether it is offered on Tech at
 * all, not the seeded list itself.
 */
describe('updateVenueSpecComponent', () => {
  const stage = { id: 'vsc_stage', key: 'stage', title: 'Stage', body: '6m x 4m.', active: true }

  beforeEach(() => {
    db.venueSpecComponent.findUnique.mockResolvedValue(stage)
    db.venueSpecComponent.update.mockResolvedValue(stage)
  })

  it('saves a new title and body', async () => {
    const said = await actions.updateVenueSpecComponent('vsc_stage', 'Stage', '8m x 5m now.')

    expect(said.kind).toBe('good')
    expect(db.venueSpecComponent.update).toHaveBeenCalledWith({
      where: { id: 'vsc_stage' },
      data: { title: 'Stage', body: '8m x 5m now.' },
    })
  })

  it('is for administrators only', async () => {
    permissions.requireModule.mockResolvedValue({ user: { ...sione, role: 'COORDINATOR' } })

    const said = await actions.updateVenueSpecComponent('vsc_stage', 'Stage', '8m x 5m now.')

    expect(said.kind).toBe('stop')
    expect(db.venueSpecComponent.update).not.toHaveBeenCalled()
  })

  it('refuses an empty title', async () => {
    const said = await actions.updateVenueSpecComponent('vsc_stage', '   ', '8m x 5m now.')

    expect(said.kind).toBe('stop')
    expect(db.venueSpecComponent.update).not.toHaveBeenCalled()
  })

  it('says when the component does not exist', async () => {
    db.venueSpecComponent.findUnique.mockResolvedValue(null)

    const said = await actions.updateVenueSpecComponent('vsc_ghost', 'Stage', 'x')

    expect(said.kind).toBe('stop')
    expect(db.venueSpecComponent.update).not.toHaveBeenCalled()
  })
})

describe('setVenueSpecComponentActive', () => {
  const backline = { id: 'vsc_backline', key: 'backline', title: 'Backline', active: true }

  beforeEach(() => {
    db.venueSpecComponent.findUnique.mockResolvedValue(backline)
    db.venueSpecComponent.update.mockResolvedValue({ ...backline, active: false })
  })

  it('turns a component off so Tech stops offering it', async () => {
    const said = await actions.setVenueSpecComponentActive('vsc_backline', false)

    expect(said.kind).toBe('good')
    expect(db.venueSpecComponent.update).toHaveBeenCalledWith({
      where: { id: 'vsc_backline' },
      data: { active: false },
    })
  })

  it('is for administrators only', async () => {
    permissions.requireModule.mockResolvedValue({ user: { ...sione, role: 'COORDINATOR' } })

    const said = await actions.setVenueSpecComponentActive('vsc_backline', false)

    expect(said.kind).toBe('stop')
    expect(db.venueSpecComponent.update).not.toHaveBeenCalled()
  })
})
