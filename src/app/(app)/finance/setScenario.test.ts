import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'
import { said } from '@/lib/toast'

/**
 * The scenario picker, moved here from Ticketing on 23 Sep 2026: "the
 * ticketing page is just for setting up the ticket sales." `setScenario` is
 * the same action Ticketing deleted (see
 * git show origin/feat/ticketing-sets-up-sales:'src/app/(app)/ticketing/actions.ts'
 * at the commit before c21d555), gated on the finance module instead of
 * ticketing — `requireModule('finance')` is the refusal for an external
 * promoter, exactly as it is for every other action in this file (see
 * `approveReview`'s comment): Finance is never in their module set, so a
 * promoter and any other role without it are refused the same way.
 */

vi.mock('server-only', () => ({}))

const requireModule = vi.fn()
const requireEvent = vi.fn()
vi.mock('@/lib/permissions', () => ({
  requireModule: (...args: unknown[]) => requireModule(...args),
  requireEvent: (...args: unknown[]) => requireEvent(...args),
}))

const db = { event: { update: vi.fn() } }
vi.mock('@/lib/db', () => ({ db }))

const refresh = vi.fn()
vi.mock('next/cache', () => ({ refresh: () => refresh() }))

const record = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...args: unknown[]) => record(...args) }))

const { setScenario } = await import('./actions')

const EVENT = 'evt_slow_fold'

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

beforeEach(() => {
  requireModule.mockReset()
  requireEvent.mockReset().mockResolvedValue(EVENT)
  db.event.update.mockReset().mockResolvedValue({})
  record.mockReset().mockResolvedValue(undefined)
  refresh.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * Both cases below fail at the same gate — `requireModule('finance')` — the
 * one check every other action in this file relies on. There is no second,
 * bespoke "is this user external" branch to route around it.
 */
describe('setScenario, refused before anything is written', () => {
  it('refuses a promoter — Finance is never in their module set', async () => {
    requireModule.mockRejectedValue(new Error('not found'))

    await expect(setScenario(EVENT, 1)).rejects.toThrow()
    expect(db.event.update).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refuses a venue role that does not carry the finance module', async () => {
    requireModule.mockRejectedValue(new Error('not found'))

    await expect(setScenario(EVENT, 1)).rejects.toThrow()
    expect(db.event.update).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('setScenario, allowed for a coordinator with finance', () => {
  beforeEach(() => {
    requireModule.mockResolvedValue({ user: mere, modules: ['finance'] })
  })

  it('checks the finance module and the event before anything else', async () => {
    await setScenario(EVENT, 2)
    expect(requireModule).toHaveBeenCalledWith('finance')
    expect(requireEvent).toHaveBeenCalledWith(mere, EVENT)
  })

  it('refuses a scenario that is not one of the three, and writes nothing', async () => {
    await expect(setScenario(EVENT, 3)).resolves.toEqual(
      said('That is not one of the scenarios.', 'stop'),
    )
    expect(db.event.update).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('writes the chosen scenario onto the event', async () => {
    await setScenario(EVENT, 2)
    expect(db.event.update).toHaveBeenCalledWith({ where: { id: EVENT }, data: { scen: 2 } })
  })

  it('refreshes the page, so the projection it moves changes with it', async () => {
    await setScenario(EVENT, 0)
    expect(refresh).toHaveBeenCalled()
  })

  it('records which case the projection now reads, as the Ticketing action did', async () => {
    await setScenario(EVENT, 0)
    expect(record).toHaveBeenCalledWith(EVENT, mere, expect.stringContaining('quiet'))
  })
})
