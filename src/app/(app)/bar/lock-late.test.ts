import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

/**
 * Locking a bar budget late, for a night that went on sale before budgets
 * locked by themselves.
 *
 * "On sale" was a stage. Each event now carries a status per part, and a
 * show is on sale when Gather.rsvp is live — so that is what this asks. A
 * night whose tickets are not live yet has nothing to lock late: its budget
 * locks by itself when they go live. See src/app/(app)/promo/actions.ts.
 */

const ana = {
  id: 'user_ana',
  email: 'ana@xchc.test',
  name: 'Ana Kelliher',
  role: 'BAR',
  roleKey: 'bar',
  organisationId: null,
  organisationName: null,
  external: false,
  personId: 'person_ana',
  initials: 'AK',
  authenticated: true,
  sessionId: 'session_ana',
} satisfies SessionUser

vi.mock('@/lib/permissions', () => ({
  requireModule: vi.fn(async () => ({ user: ana, modules: ['bar'] })),
  requireEvent: vi.fn(async (_: unknown, id: string) => id),
}))

const findEvent = vi.fn()
const createBudget = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    event: { findUniqueOrThrow: (...a: unknown[]) => findEvent(...a) },
    barBudget: { create: (...a: unknown[]) => createBudget(...a) },
  },
}))

const budgetToLock = vi.fn()
vi.mock('@/lib/bar-data', () => ({
  budgetToLock: (...a: unknown[]) => budgetToLock(...a),
  tillWindowFor: vi.fn(),
}))
vi.mock('@/lib/eposnow', () => ({ isConfigured: vi.fn(), readTill: vi.fn() }))

const record = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...a: unknown[]) => record(...a) }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))

const { lockBudgetLate } = await import('./actions')

const EVENT = 'evt_static_bloom'
const FIGURES = {
  heads: 136,
  spendPerHead: 20,
  margin: 1415,
  stockCostPct: 0.402,
  labourHours: 11,
  loadedRate: 33.66,
}

/** The event as the action reads it: its Gather.rsvp row, and any budget. */
const eventIs = (ticketsLive: boolean | null, barBudget: { id: string } | null = null) =>
  findEvent.mockResolvedValue({
    channels: ticketsLive === null ? [] : [{ live: ticketsLive }],
    barBudget,
  })

beforeEach(() => {
  vi.clearAllMocks()
  budgetToLock.mockResolvedValue(FIGURES)
  createBudget.mockResolvedValue({})
})

describe('locking a bar budget late', () => {
  it('asks whether Gather.rsvp is live, not what stage the event is at', async () => {
    eventIs(true)
    await lockBudgetLate(EVENT)
    expect(findEvent.mock.calls[0]![0]).toMatchObject({
      where: { id: EVENT },
      select: { channels: { where: { channel: 'gather' } } },
    })
  })

  it('locks one, marked late, for a night already on sale', async () => {
    eventIs(true)

    const out = await lockBudgetLate(EVENT)

    expect(out.kind).toBe('good')
    expect(createBudget).toHaveBeenCalledWith({
      data: { eventId: EVENT, ...FIGURES, basis: 'LATE', lockedBy: 'AK' },
    })
  })

  it('has nothing to lock before tickets are on sale', async () => {
    for (const live of [false, null]) {
      eventIs(live)
      const out = await lockBudgetLate(EVENT)
      expect(out.kind).toBe('warn')
      expect(out.text).toMatch(/locks by itself when the event goes on sale/)
    }
    expect(createBudget).not.toHaveBeenCalled()
  })

  it('never rewrites a budget that exists', async () => {
    eventIs(true, { id: 'budget_1' })
    const out = await lockBudgetLate(EVENT)
    expect(out.kind).toBe('warn')
    expect(createBudget).not.toHaveBeenCalled()
  })
})
