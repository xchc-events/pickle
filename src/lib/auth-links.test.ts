import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LINK_COOLDOWN_SECONDS } from './auth-rules'

/**
 * Emailing a link: the cooldown, the token, the right email, the trail.
 *
 * Two callers see this differently. An administrator sending an invitation is
 * told exactly what happened. Somebody on the sign-in page is told the same
 * thing whatever happened — see `emailLinkQuietly` — because "we sent it" and
 * "there is no such account" must be indistinguishable to a stranger.
 */

vi.mock('server-only', () => ({}))

const authData = {
  accountByEmail: vi.fn(),
  lastLinkSentAt: vi.fn(),
  issueLink: vi.fn(),
  recordAuthEvent: vi.fn(),
}
vi.mock('./auth-data', () => authData)

const email = { sendMail: vi.fn(), emailConfigured: vi.fn() }
vi.mock('./email', () => email)

const links = await import('./auth-links')

const mere = { id: 'u_mere', email: 'mere.tapu@xchc.co.nz', name: 'Mere Tapu', active: true }
const url = 'https://pickle.minim.nz/sign-in/link/' + 'z'.repeat(43)

beforeEach(() => {
  vi.unstubAllEnvs()
  for (const fn of [...Object.values(authData), ...Object.values(email)]) fn.mockReset()
  authData.lastLinkSentAt.mockResolvedValue(null)
  authData.issueLink.mockResolvedValue({ url, expires: new Date() })
  email.sendMail.mockResolvedValue('sent')
  email.emailConfigured.mockReturnValue(true)
})

describe('emailLink', () => {
  it('sends the right email for each kind of link', async () => {
    await links.emailLink(mere, 'SIGN_IN')
    expect(email.sendMail).toHaveBeenLastCalledWith(
      mere.email,
      expect.objectContaining({ subject: expect.stringMatching(/sign-in link/i) }),
    )

    await links.emailLink(mere, 'INVITE')
    expect(email.sendMail).toHaveBeenLastCalledWith(
      mere.email,
      expect.objectContaining({ text: expect.stringMatching(/Kia ora Mere/) }),
    )

    await links.emailLink(mere, 'RESET')
    expect(email.sendMail).toHaveBeenLastCalledWith(
      mere.email,
      expect.objectContaining({ subject: expect.stringMatching(/new password/i) }),
    )
  })

  it('puts the link it issued in the email', async () => {
    await links.emailLink(mere, 'RESET')
    expect(email.sendMail.mock.calls[0][1].text).toContain(url)
  })

  it('sends nothing inside the cooldown, and says so', async () => {
    authData.lastLinkSentAt.mockResolvedValue(new Date(Date.now() - 5_000))

    expect(await links.emailLink(mere, 'INVITE')).toBe('cooling')
    expect(authData.issueLink).not.toHaveBeenCalled()
    expect(email.sendMail).not.toHaveBeenCalled()
  })

  it('sends once the cooldown is over', async () => {
    authData.lastLinkSentAt.mockResolvedValue(
      new Date(Date.now() - (LINK_COOLDOWN_SECONDS + 1) * 1000),
    )
    expect(await links.emailLink(mere, 'INVITE')).toBe('sent')
  })

  it('is unavailable, and sends nothing, when there is nowhere safe to point a link', async () => {
    authData.issueLink.mockResolvedValue(null)

    expect(await links.emailLink(mere, 'RESET')).toBe('unavailable')
    expect(email.sendMail).not.toHaveBeenCalled()
  })

  /**
   * A production install with no mail keys cannot send anything. Minting a
   * token first would leave a live link nobody received, and start a cooldown
   * for an email that never went — so it stops before either.
   */
  it('issues nothing in production when mail is not configured, and says why', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    email.emailConfigured.mockReturnValue(false)

    expect(await links.emailLink(mere, 'INVITE')).toBe('unconfigured')
    expect(authData.issueLink).not.toHaveBeenCalled()
    expect(email.sendMail).not.toHaveBeenCalled()
  })

  it('still goes ahead without mail keys outside production, where it is logged', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    email.emailConfigured.mockReturnValue(false)
    email.sendMail.mockResolvedValue('logged')

    expect(await links.emailLink(mere, 'INVITE')).toBe('logged')
  })

  it('records what went out, and which administrator sent it', async () => {
    await links.emailLink(mere, 'INVITE', 'u_sione')
    expect(authData.recordAuthEvent).toHaveBeenCalledWith('INVITE_SENT', {
      email: mere.email,
      userId: mere.id,
      actorId: 'u_sione',
    })

    await links.emailLink(mere, 'SIGN_IN')
    expect(authData.recordAuthEvent).toHaveBeenLastCalledWith('LINK_SENT', {
      email: mere.email,
      userId: mere.id,
      actorId: null,
    })
  })

  it('reports a dev-server log as logged rather than sent', async () => {
    email.sendMail.mockResolvedValue('logged')
    expect(await links.emailLink(mere, 'INVITE')).toBe('logged')
  })

  it('lets a refusal from the mail service through to an administrator', async () => {
    email.sendMail.mockRejectedValue(new Error('Resend refused the message'))
    await expect(links.emailLink(mere, 'INVITE')).rejects.toThrow(/Resend/)
  })
})

describe('emailLinkQuietly', () => {
  it('sends to an account that is on', async () => {
    authData.accountByEmail.mockResolvedValue(mere)
    await links.emailLinkQuietly(mere.email, 'RESET')
    expect(email.sendMail).toHaveBeenCalledOnce()
  })

  it('does nothing at all for an address with no account', async () => {
    authData.accountByEmail.mockResolvedValue(null)
    await links.emailLinkQuietly('stranger@example.test', 'RESET')
    expect(authData.issueLink).not.toHaveBeenCalled()
    expect(email.sendMail).not.toHaveBeenCalled()
  })

  it('does nothing for an account that has been switched off', async () => {
    authData.accountByEmail.mockResolvedValue({ ...mere, active: false })
    await links.emailLinkQuietly(mere.email, 'SIGN_IN')
    expect(authData.issueLink).not.toHaveBeenCalled()
  })

  /**
   * It runs after the response has gone, so a failure has nobody to be shown
   * to — and showing it would say the account exists. It goes to the log.
   */
  it('logs a failure rather than throwing it', async () => {
    authData.accountByEmail.mockResolvedValue(mere)
    email.sendMail.mockRejectedValue(new Error('Resend refused the message'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(links.emailLinkQuietly(mere.email, 'RESET')).resolves.toBeUndefined()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('notifyPasswordChanged', () => {
  it('points the owner at the reset page, on the configured address', async () => {
    vi.stubEnv('AUTH_URL', 'https://pickle.minim.nz')
    await links.notifyPasswordChanged(mere.email, new Date())
    expect(email.sendMail.mock.calls[0][1].text).toContain('https://pickle.minim.nz/sign-in/forgot')
  })

  it('never throws — the password has already changed by the time this runs', async () => {
    email.sendMail.mockRejectedValue(new Error('down'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(links.notifyPasswordChanged(mere.email, new Date())).resolves.toBeUndefined()
    log.mockRestore()
  })
})
