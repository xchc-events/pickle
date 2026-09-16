import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

/**
 * Tech production sending an act a link for their details and rider.
 *
 * `issueGrant` refusing is tested as a rule in src/lib/grants.test.ts. This is
 * about what the coordinator is told when it does. In production with no
 * AUTH_URL the action used to hand back http://localhost:3000/g/… — a link
 * that copies and pastes like any other and is dead to the act who opens it.
 * Now the coordinator is told why there is no link, and nothing is written:
 * no grant, and no activity line saying a link went out.
 *
 * The grant writer is the real one, over a stand-in database, so these cases
 * follow the refusal from the setting all the way to the words on screen.
 * CI sets AUTH_URL for the whole job, so every case sets it for itself.
 */

vi.mock('server-only', () => ({}))

const requireModule = vi.fn()
const requireEvent = vi.fn()

vi.mock('@/lib/permissions', () => ({
  requireModule: (...args: unknown[]) => requireModule(...args),
  requireEvent: (...args: unknown[]) => requireEvent(...args),
}))

const db = {
  eventArtist: { findFirst: vi.fn() },
  accessGrant: { create: vi.fn() },
}
vi.mock('@/lib/db', () => ({ db }))

const record = vi.fn()
const refresh = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...args: unknown[]) => record(...args) }))
vi.mock('next/cache', () => ({ refresh: () => refresh() }))

// Uploads are not under test here. Reaching one is a mistake, not a pass.
const stop = (what: string) => (): never => {
  throw new Error(`reached ${what}`)
}
vi.mock('@/lib/files-data', () => ({
  begin: stop('files.begin'),
  finish: stop('files.finish'),
  linkTo: stop('files.linkTo'),
}))

const { NO_LINK_ADDRESS } = await import('@/lib/grants-data')
const { issueArtistLink } = await import('./actions')

/** Slow Fold, on the night Tech is working on. */
const EVENT = 'evt_slow_fold'
const ARTIST = 'artist_slow_fold'

const mere = {
  id: 'user_mere',
  name: 'Mere Tapu',
  role: 'COORDINATOR',
  roleKey: 'coordinator',
  organisationId: null,
  organisationName: null,
  external: false,
  personId: 'person_mere',
  initials: 'MT',
  authenticated: true,
} satisfies SessionUser

const send = () => issueArtistLink(EVENT, ARTIST)

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  requireModule.mockReset().mockResolvedValue({ user: mere, modules: ['tech'] })
  requireEvent.mockReset().mockResolvedValue(EVENT)
  db.eventArtist.findFirst
    .mockReset()
    .mockResolvedValue({ name: 'Slow Fold', payeeId: 'payee_slow_fold' })
  db.accessGrant.create.mockReset().mockResolvedValue({})
  record.mockReset()
  refresh.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('issueArtistLink, in production with no AUTH_URL', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_URL', undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('tells the coordinator links cannot be issued until AUTH_URL is set', async () => {
    await expect(send()).resolves.toEqual({ ok: false, why: NO_LINK_ADDRESS })
  })

  it('hands back no URL at all — not even one to localhost', async () => {
    const res = await send()
    expect(res.url).toBeUndefined()
    expect(JSON.stringify(res)).not.toContain('localhost')
  })

  it('mints no grant, so no live token exists that nobody can use', async () => {
    await send()
    expect(db.accessGrant.create).not.toHaveBeenCalled()
  })

  it('writes no activity line and refreshes nothing — no link went out', async () => {
    await send()
    expect(record).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('still asks for a payee record first, which the coordinator can fix', async () => {
    db.eventArtist.findFirst.mockResolvedValue({ name: 'Slow Fold', payeeId: null })
    await expect(send()).resolves.toEqual({
      ok: false,
      why: expect.stringMatching(/payee record/),
    })
  })
})

describe('issueArtistLink, with AUTH_URL set', () => {
  beforeEach(() => {
    vi.stubEnv('AUTH_URL', 'https://pickle.minim.nz')
  })

  it('checks the Tech module and the event before anything else', async () => {
    await send()
    expect(requireModule).toHaveBeenCalledWith('tech')
    expect(requireEvent).toHaveBeenCalledWith(mere, EVENT)
    expect(db.eventArtist.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ARTIST, eventId: EVENT } }),
    )
  })

  it('hands the coordinator a link on the configured address', async () => {
    await expect(send()).resolves.toEqual({
      ok: true,
      url: expect.stringMatching(/^https:\/\/pickle\.minim\.nz\/g\/[A-Za-z0-9_-]{43,}$/),
      expires: expect.any(String),
    })
  })

  it('mints one grant for the act on this event, and says so on the event', async () => {
    await send()

    expect(db.accessGrant.create).toHaveBeenCalledTimes(1)
    expect(db.accessGrant.create.mock.calls[0][0].data).toMatchObject({
      scope: 'BOTH',
      payeeId: 'payee_slow_fold',
      eventId: EVENT,
      createdById: 'person_mere',
    })
    expect(record).toHaveBeenCalledWith(EVENT, mere, expect.stringContaining('Slow Fold'))
    expect(refresh).toHaveBeenCalled()
  })
})
