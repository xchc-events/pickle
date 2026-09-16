import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

/**
 * Finance chasing a payee for their payment details.
 *
 * The other caller of `issueGrant`, beside Tech production's act link, and it
 * failed the same way: in production with no AUTH_URL it handed back a link
 * to localhost for somebody to paste into an email. Now it says why there is
 * no link and writes nothing — no grant, and no activity line claiming a
 * payment-details link was issued.
 *
 * As in src/app/(app)/tech/actions.test.ts, the grant writer is the real one
 * over a stand-in database, and every case sets AUTH_URL for itself because
 * CI sets it for the whole job.
 */

vi.mock('server-only', () => ({}))

const requireModule = vi.fn()
const requireEvent = vi.fn()

vi.mock('@/lib/permissions', () => ({
  requireModule: (...args: unknown[]) => requireModule(...args),
  requireEvent: (...args: unknown[]) => requireEvent(...args),
}))

const db = {
  payee: { findUnique: vi.fn() },
  activity: { create: vi.fn() },
  accessGrant: { create: vi.fn() },
}
vi.mock('@/lib/db', () => ({ db }))

const refresh = vi.fn()
vi.mock('next/cache', () => ({ refresh: () => refresh() }))

// Revealing and erasing are not under test here. Reaching either is a
// mistake, not a pass.
const stop = (what: string) => (): never => {
  throw new Error(`reached ${what}`)
}
vi.mock('@/lib/payments-data', () => ({
  revealFor: stop('revealFor'),
  forgetDetails: stop('forgetDetails'),
}))
vi.mock('@/lib/activity', () => ({ record: stop('record') }))

const { NO_LINK_ADDRESS } = await import('@/lib/grants-data')
const { chaseDetails } = await import('./actions')

/** Slow Fold's night, and the act whose bank details never arrived. */
const EVENT = 'evt_slow_fold'
const PAYEE = 'payee_slow_fold'

const mere = {
  id: 'user_mere',
  email: 'mere@xchc.test',
  name: 'Mere Tapu',
  role: 'COORDINATOR',
  roleKey: 'coordinator',
  organisationId: null,
  organisationName: null,
  external: false,
  personId: 'person_mere',
  initials: 'MT',
  authenticated: true,
  sessionId: 'session_mere',
} satisfies SessionUser

const chase = () => chaseDetails(EVENT, PAYEE)

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  requireModule.mockReset().mockResolvedValue({ user: mere, modules: ['finance'] })
  requireEvent.mockReset().mockResolvedValue(EVENT)
  db.payee.findUnique.mockReset().mockResolvedValue({ name: 'Slow Fold' })
  db.activity.create.mockReset().mockResolvedValue({})
  db.accessGrant.create.mockReset().mockResolvedValue({})
  refresh.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('chaseDetails, in production with no AUTH_URL', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_URL', undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('tells the coordinator links cannot be issued until AUTH_URL is set', async () => {
    await expect(chase()).resolves.toEqual({ ok: false, why: NO_LINK_ADDRESS })
  })

  it('hands back no URL at all — not even one to localhost', async () => {
    const res = await chase()
    expect(res.url).toBeUndefined()
    expect(JSON.stringify(res)).not.toContain('localhost')
  })

  it('mints no grant, so no live token exists that nobody can use', async () => {
    await chase()
    expect(db.accessGrant.create).not.toHaveBeenCalled()
  })

  it('writes no activity line and refreshes nothing — no link was issued', async () => {
    await chase()
    expect(db.activity.create).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('still says so when the payee does not exist', async () => {
    db.payee.findUnique.mockResolvedValue(null)
    await expect(chase()).resolves.toEqual({ ok: false, why: 'No such payee.' })
  })
})

describe('chaseDetails, with AUTH_URL set', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_URL', 'https://pickle.minim.nz')
  })

  it('checks the Finance module and the event before anything else', async () => {
    await chase()
    expect(requireModule).toHaveBeenCalledWith('finance')
    expect(requireEvent).toHaveBeenCalledWith(mere, EVENT)
  })

  it('hands the coordinator a link on the configured address', async () => {
    await expect(chase()).resolves.toEqual({
      ok: true,
      url: expect.stringMatching(/^https:\/\/pickle\.minim\.nz\/g\/[A-Za-z0-9_-]{43,}$/),
    })
  })

  it('mints one payment-details grant for the payee, and says so on the event', async () => {
    await chase()

    expect(db.accessGrant.create).toHaveBeenCalledTimes(1)
    expect(db.accessGrant.create.mock.calls[0][0].data).toMatchObject({
      scope: 'PAYMENT_DETAILS',
      payeeId: PAYEE,
      eventId: EVENT,
      createdById: 'person_mere',
    })
    expect(db.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: EVENT,
        personId: 'person_mere',
        text: expect.stringContaining('Slow Fold'),
      }),
    })
    expect(refresh).toHaveBeenCalled()
  })
})
