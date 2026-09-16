import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

/**
 * Pushing a channel live, against the one order between parts that still
 * refuses: tickets do not go on sale until the booking is confirmed — and the
 * bar budget, which locks at the moment tickets do go on sale.
 *
 * `canGoOnSale` is tested as a rule in parts.test.ts. This is about whether
 * the action that actually puts Gather.rsvp live asks it. Every other part of
 * an event may run ahead of the booking, so the check has to be on this one
 * channel and nowhere else — a listing on Facebook for a tour date is not a
 * ticket sold.
 */

const requireModule = vi.fn()
const requireEvent = vi.fn()
vi.mock('@/lib/permissions', () => ({
  requireModule: (...a: unknown[]) => requireModule(...a),
  requireEvent: (...a: unknown[]) => requireEvent(...a),
}))

const findEvent = vi.fn()
const findPush = vi.fn()
const upsertPush = vi.fn()
const upsertBudget = vi.fn()
const transaction = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    event: { findUniqueOrThrow: (...a: unknown[]) => findEvent(...a) },
    channelPush: {
      findUnique: (...a: unknown[]) => findPush(...a),
      upsert: (...a: unknown[]) => upsertPush(...a),
    },
    barBudget: { upsert: (...a: unknown[]) => upsertBudget(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}))

const budgetToLock = vi.fn()
vi.mock('@/lib/bar-data', () => ({ budgetToLock: (...a: unknown[]) => budgetToLock(...a) }))

const record = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...a: unknown[]) => record(...a) }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))

const { pushChannel } = await import('./actions')

const tui = {
  id: 'user_tui',
  email: 'tui@xchc.test',
  name: 'Tui Ware',
  role: 'DESIGN',
  roleKey: 'design',
  organisationId: null,
  organisationName: null,
  external: false,
  personId: 'person_tui',
  initials: 'TW',
  authenticated: true,
  sessionId: 'session_tui',
} satisfies SessionUser

const EVENT = 'evt_wax_lyrical'

const bookingIs = (
  status: 'ENQUIRY' | 'NEGOTIATING' | 'CONFIRMED',
  barBudget: { id: string } | null = null,
) => findEvent.mockResolvedValue({ bookingStatus: status, barBudget })

/** What the bar was expected to do, as `budgetToLock` hands it over. */
const FIGURES = {
  heads: 145,
  spendPerHead: 20,
  margin: 1508.61,
  stockCostPct: 0.402,
  labourHours: 11,
  loadedRate: 33.66,
}

beforeEach(() => {
  vi.clearAllMocks()
  requireModule.mockResolvedValue({ user: tui, modules: ['promo'] })
  requireEvent.mockResolvedValue(EVENT)
  findPush.mockResolvedValue(null)
  upsertPush.mockResolvedValue({})
  upsertBudget.mockResolvedValue({})
  budgetToLock.mockResolvedValue(FIGURES)
  // A batch transaction: every write in it, or none of them.
  transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops))
})

describe('pushing Gather.rsvp live', () => {
  it('is refused while the booking is an enquiry or still being negotiated', async () => {
    for (const status of ['ENQUIRY', 'NEGOTIATING'] as const) {
      bookingIs(status)
      const out = await pushChannel(EVENT, 'gather')
      expect(out.kind).toBe('stop')
      expect(out.text).toMatch(/booking is confirmed/)
    }
    // Refused, not recorded: nothing went live, so nothing happened.
    expect(upsertPush).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
    expect(budgetToLock).not.toHaveBeenCalled()
  })

  it('goes ahead once the booking is confirmed', async () => {
    bookingIs('CONFIRMED')
    const out = await pushChannel(EVENT, 'gather')
    expect(out.kind).toBe('good')
    expect(upsertPush).toHaveBeenCalledOnce()
    expect(upsertPush.mock.calls[0]![0]).toMatchObject({
      create: { channel: 'gather', live: true },
    })
    expect(record).toHaveBeenCalledWith(EVENT, tui, 'listed on Gather.rsvp')
  })

  it('checks the event it was asked about, after the scope check has passed', async () => {
    bookingIs('CONFIRMED')
    await pushChannel(EVENT, 'gather')
    expect(requireEvent).toHaveBeenCalledWith(tui, EVENT)
    expect(findEvent.mock.calls[0]![0]).toMatchObject({ where: { id: EVENT } })
  })
})

describe('pushing any other channel', () => {
  it('does not wait for the booking — a listing is not a ticket', async () => {
    bookingIs('NEGOTIATING')
    const out = await pushChannel(EVENT, 'facebook-event')
    expect(out.kind).toBe('good')
    expect(upsertPush).toHaveBeenCalledOnce()
  })
})

/**
 * The bar budget is frozen at what was believed when tickets went on sale, so
 * the night's bar can be measured against it afterwards. Going on sale used to
 * be a move between stages; it is now Gather.rsvp going live, so the lock
 * moved here with it — in the same transaction, so a show never goes on sale
 * without one.
 */
describe('the bar budget, when tickets first go on sale', () => {
  it('locks in the same transaction as the push', async () => {
    bookingIs('CONFIRMED')

    const out = await pushChannel(EVENT, 'gather')

    expect(transaction).toHaveBeenCalledOnce()
    expect(transaction.mock.calls[0]![0]).toHaveLength(2)
    expect(budgetToLock).toHaveBeenCalledWith(EVENT)
    expect(upsertBudget).toHaveBeenCalledWith({
      where: { eventId: EVENT },
      create: { eventId: EVENT, ...FIGURES, basis: 'ON_SALE', lockedBy: 'TW' },
      // A budget is never rewritten, even by two pushes landing at once.
      update: {},
    })
    expect(out.kind).toBe('good')
    expect(out.text).toMatch(/bar budget is locked/)
  })

  it('records what it was locked at', async () => {
    bookingIs('CONFIRMED')
    await pushChannel(EVENT, 'gather')
    const lines = record.mock.calls.map((c) => c[2] as string)
    expect(lines[0]).toBe('listed on Gather.rsvp')
    expect(lines[1]).toMatch(/^locked the bar budget — 145 heads at \$20, /)
  })

  it('does not lock again on a push to a listing already live', async () => {
    bookingIs('CONFIRMED')
    findPush.mockResolvedValue({ live: true })

    await pushChannel(EVENT, 'gather')

    expect(budgetToLock).not.toHaveBeenCalled()
    expect(upsertBudget).not.toHaveBeenCalled()
    expect(upsertPush).toHaveBeenCalledOnce()
  })

  it('leaves a budget that exists alone when tickets are relisted', async () => {
    bookingIs('CONFIRMED', { id: 'budget_1' })
    findPush.mockResolvedValue({ live: false })

    await pushChannel(EVENT, 'gather')

    expect(budgetToLock).not.toHaveBeenCalled()
    expect(record.mock.calls.map((c) => c[2])).toEqual(['listed on Gather.rsvp'])
  })

  it('locks nothing for any other channel', async () => {
    bookingIs('CONFIRMED')
    await pushChannel(EVENT, 'facebook-event')
    expect(budgetToLock).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })
})
