import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

/**
 * The offered person answering from Home themself — gated on nothing but
 * being the person the shift is offered to. The actual confirm/decline
 * transaction is shared with Roster and the emailed link and is tested once,
 * in src/lib/shift-offers-data.test.ts; this is only the gate in front of it.
 */

const ari = {
  id: 'user_ari',
  email: 'ari@xchc.test',
  name: 'Ari Ngata',
  role: 'BAR',
  roleKey: 'bar',
  organisationId: null,
  organisationName: null,
  external: false,
  personId: 'person_ari',
  initials: 'AN',
  authenticated: true,
  sessionId: 'session_ari',
} satisfies SessionUser

const requireModuleMock = vi.fn()
vi.mock('@/lib/permissions', () => ({
  requireModule: (...a: unknown[]) => requireModuleMock(...a),
}))

const shiftFindFirst = vi.fn()
vi.mock('@/lib/db', () => ({
  db: { shift: { findFirst: (...a: unknown[]) => shiftFindFirst(...a) } },
}))

const confirmOfferedShift = vi.fn()
const declineOfferedShift = vi.fn()
vi.mock('@/lib/shift-offers-data', () => ({
  confirmOfferedShift: (...a: unknown[]) => confirmOfferedShift(...a),
  declineOfferedShift: (...a: unknown[]) => declineOfferedShift(...a),
}))

const refresh = vi.fn()
vi.mock('next/cache', () => ({ refresh: () => refresh() }))

const { confirmMyOffer, declineMyOffer } = await import('./actions')

beforeEach(() => {
  vi.clearAllMocks()
  requireModuleMock.mockResolvedValue({ user: ari, modules: ['home'] })
})

describe('confirmMyOffer', () => {
  it('confirms when the shift is offered to the signed-in person', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift_bar' })
    confirmOfferedShift.mockResolvedValue({ kind: 'good', text: 'Ari Ngata is on Bar staff.' })

    const out = await confirmMyOffer('shift_bar')

    expect(shiftFindFirst).toHaveBeenCalledWith({
      where: { id: 'shift_bar', personId: 'person_ari', state: 'OFFERED' },
      select: { id: true },
    })
    expect(confirmOfferedShift).toHaveBeenCalledWith('shift_bar', {
      personId: 'person_ari',
      who: 'AN',
    })
    expect(out.text).toBe('Ari Ngata is on Bar staff.')
    expect(refresh).toHaveBeenCalled()
  })

  it("another person's account cannot confirm it — refuses without calling through", async () => {
    // Scoped to this person in the query itself; a shift offered to somebody
    // else, or not offered at all, is simply not found.
    shiftFindFirst.mockResolvedValue(null)

    const out = await confirmMyOffer('shift_someone_elses')

    expect(out.kind).toBe('stop')
    expect(confirmOfferedShift).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refuses an account with no linked person, without querying', async () => {
    requireModuleMock.mockResolvedValueOnce({
      user: { ...ari, personId: null },
      modules: ['home'],
    })

    const out = await confirmMyOffer('shift_bar')

    expect(out.kind).toBe('stop')
    expect(shiftFindFirst).not.toHaveBeenCalled()
    expect(confirmOfferedShift).not.toHaveBeenCalled()
  })

  it('propagates the module gate refusing anyone without Home', async () => {
    requireModuleMock.mockRejectedValueOnce(new Error('not found'))

    await expect(confirmMyOffer('shift_bar')).rejects.toThrow()
    expect(confirmOfferedShift).not.toHaveBeenCalled()
  })
})

describe('declineMyOffer', () => {
  it('declines when the shift is offered to the signed-in person', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift_bar' })
    declineOfferedShift.mockResolvedValue({ kind: 'warn', text: 'Bar staff is open again.' })

    const out = await declineMyOffer('shift_bar')

    expect(declineOfferedShift).toHaveBeenCalledWith('shift_bar', {
      personId: 'person_ari',
      who: 'AN',
    })
    expect(out.text).toBe('Bar staff is open again.')
    expect(refresh).toHaveBeenCalled()
  })

  it("another person's account cannot decline it", async () => {
    shiftFindFirst.mockResolvedValue(null)

    const out = await declineMyOffer('shift_someone_elses')

    expect(out.kind).toBe('stop')
    expect(declineOfferedShift).not.toHaveBeenCalled()
  })
})
