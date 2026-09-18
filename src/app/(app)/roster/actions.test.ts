import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

/**
 * Assigning a shift writes the hours, and the hours are one record of an hour:
 * who, which event, how long, and the day it is worked. The first three were
 * written from the start. The day was left to the column's default, the moment
 * of assigning, so a shift filled in September for an October night read as
 * September's work. These pin the day to the night.
 */

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

vi.mock('@/lib/permissions', () => ({
  requireModule: vi.fn(async () => ({ user: mere, modules: ['roster'] })),
  requireEvent: vi.fn(async (_: unknown, id: string) => id),
}))

const shiftFindFirst = vi.fn()
const shiftUpdate = vi.fn((a: unknown) => ({ op: 'shift.update', a }))
const personFindFirst = vi.fn()
const entryCreate = vi.fn((a: unknown) => ({ op: 'hourEntry.create', a }))
const entryUpdate = vi.fn((a: unknown) => ({ op: 'hourEntry.update', a }))
const entryDelete = vi.fn((a: unknown) => ({ op: 'hourEntry.delete', a }))
const transaction = vi.fn(async (ops: unknown[]) => ops)
vi.mock('@/lib/db', () => ({
  db: {
    shift: {
      findFirst: (...a: unknown[]) => shiftFindFirst(...a),
      update: (a: unknown) => shiftUpdate(a),
    },
    person: { findFirst: (...a: unknown[]) => personFindFirst(...a) },
    hourEntry: {
      create: (a: unknown) => entryCreate(a),
      update: (a: unknown) => entryUpdate(a),
      delete: (a: unknown) => entryDelete(a),
    },
    $transaction: (ops: unknown[]) => transaction(ops),
  },
}))

const record = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...a: unknown[]) => record(...a) }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))

const { assignShift } = await import('./actions')

const EVENT = 'evt_static_bloom'
const NIGHT = new Date(2026, 9, 10, 12)

const shift = (over: { hourEntry?: { id: string } | null } = {}) => ({
  id: 'shift_door',
  eventId: EVENT,
  role: 'Door',
  hours: 6,
  hourEntry: null,
  event: { date: NIGHT },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  personFindFirst.mockResolvedValue({ id: 'person_ari', name: 'Ari Ngata' })
})

describe('assignShift', () => {
  it('reads the night along with the shift', async () => {
    shiftFindFirst.mockResolvedValue(shift())

    await assignShift(EVENT, 'shift_door', 'person_ari')

    expect(shiftFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'shift_door', eventId: EVENT },
        include: expect.objectContaining({ event: { select: { date: true } } }),
      }),
    )
  })

  it('stamps the hours with the night they are worked, not the moment of assigning', async () => {
    shiftFindFirst.mockResolvedValue(shift())

    const out = await assignShift(EVENT, 'shift_door', 'person_ari')

    expect(out.kind).toBe('good')
    expect(entryCreate).toHaveBeenCalledWith({
      data: {
        personId: 'person_ari',
        eventId: EVENT,
        shiftId: 'shift_door',
        hours: 6,
        note: 'Door',
        workedOn: NIGHT,
      },
    })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'Ari Ngata on Door')
  })

  it('moves the hours to the new person and keeps them on the night', async () => {
    shiftFindFirst.mockResolvedValue(shift({ hourEntry: { id: 'entry_1' } }))

    await assignShift(EVENT, 'shift_door', 'person_ari')

    expect(entryCreate).not.toHaveBeenCalled()
    expect(entryUpdate).toHaveBeenCalledWith({
      where: { id: 'entry_1' },
      data: { personId: 'person_ari', hours: 6, eventId: EVENT, workedOn: NIGHT },
    })
  })

  it('writes the shift and its hours in one transaction', async () => {
    shiftFindFirst.mockResolvedValue(shift())

    await assignShift(EVENT, 'shift_door', 'person_ari')

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transaction.mock.calls[0][0]).toEqual([
      expect.objectContaining({ op: 'shift.update' }),
      expect.objectContaining({ op: 'hourEntry.create' }),
    ])
  })

  it('takes the hours off the event when the shift goes back to open', async () => {
    shiftFindFirst.mockResolvedValue(shift({ hourEntry: { id: 'entry_1' } }))

    const out = await assignShift(EVENT, 'shift_door', '')

    expect(entryDelete).toHaveBeenCalledWith({ where: { id: 'entry_1' } })
    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: 'shift_door' },
      data: { personId: null, state: 'OPEN' },
    })
    expect(out.kind).toBe('warn')
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'took Door back to open')
  })

  it('refuses a shift that is not on this event, and writes nothing', async () => {
    shiftFindFirst.mockResolvedValue(null)

    const out = await assignShift(EVENT, 'shift_elsewhere', 'person_ari')

    expect(out.kind).toBe('stop')
    expect(transaction).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses somebody who does not work here, and writes nothing', async () => {
    shiftFindFirst.mockResolvedValue(shift())
    personFindFirst.mockResolvedValue(null)

    const out = await assignShift(EVENT, 'shift_door', 'person_gone')

    expect(out.kind).toBe('stop')
    expect(transaction).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })
})
