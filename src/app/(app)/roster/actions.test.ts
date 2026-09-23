import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

// retimeShift pulls in offsetFromClock from '@/lib/roster-data', a
// server-only module — neutralise the guard the same way
// roster-data.test.ts does, so its pure functions can run here unmocked.
vi.mock('server-only', () => ({}))

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

const requireModuleMock = vi.fn()
const requireEventMock = vi.fn()
vi.mock('@/lib/permissions', () => ({
  requireModule: (...a: unknown[]) => requireModuleMock(...a),
  requireEvent: (...a: unknown[]) => requireEventMock(...a),
}))

const shiftFindFirst = vi.fn()
const shiftUpdate = vi.fn((a: unknown) => ({ op: 'shift.update', a }))
const shiftCreate = vi.fn((a: unknown) => ({ op: 'shift.create', a }))
const shiftDelete = vi.fn((a: unknown) => ({ op: 'shift.delete', a }))
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
      create: (a: unknown) => shiftCreate(a),
      delete: (a: unknown) => shiftDelete(a),
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

const { assignShift, renameShift, retimeShift, duplicateShift, deleteShift } =
  await import('./actions')

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
  requireModuleMock.mockResolvedValue({ user: mere, modules: ['roster'] })
  requireEventMock.mockImplementation(async (_: unknown, id: string) => id)
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

const external = {
  ...mere,
  id: 'user_amy',
  external: true,
  initials: 'AP',
} satisfies SessionUser

describe('renameShift', () => {
  it('renames the role and writes an activity line', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift_door', role: 'Door' })

    const out = await renameShift(EVENT, 'shift_door', 'Door (extra)')

    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: 'shift_door' },
      data: { role: 'Door (extra)' },
    })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'renamed Door to Door (extra)')
    expect(out.kind).toBe('good')
  })

  it('keeps everything else, only the role is in the update', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift_door', role: 'Door' })

    await renameShift(EVENT, 'shift_door', 'Front door')

    // toHaveBeenCalledWith is an exact match, so this alone proves the
    // update data carries nothing besides the new role.
    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: 'shift_door' },
      data: { role: 'Front door' },
    })
    expect(entryUpdate).not.toHaveBeenCalled()
    expect(entryDelete).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('trims the name and does nothing when it has not actually changed', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift_door', role: 'Door' })

    const out = await renameShift(EVENT, 'shift_door', '  Door  ')

    expect(shiftUpdate).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
    expect(out.kind).toBe('warn')
  })

  it('refuses a blank name without reading the shift', async () => {
    const out = await renameShift(EVENT, 'shift_door', '   ')

    expect(shiftFindFirst).not.toHaveBeenCalled()
    expect(out.kind).toBe('stop')
  })

  it('refuses a shift that is not on this event, and writes nothing', async () => {
    shiftFindFirst.mockResolvedValue(null)

    const out = await renameShift(EVENT, 'shift_elsewhere', 'Door (extra)')

    expect(out.kind).toBe('stop')
    expect(shiftUpdate).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses an external account, and writes nothing', async () => {
    requireModuleMock.mockResolvedValueOnce({ user: external, modules: ['roster'] })

    const out = await renameShift(EVENT, 'shift_door', 'Door (extra)')

    expect(out.kind).toBe('stop')
    expect(shiftFindFirst).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('propagates the module gate refusing anyone without the roster module', async () => {
    requireModuleMock.mockRejectedValueOnce(new Error('not found'))

    await expect(renameShift(EVENT, 'shift_door', 'Door (extra)')).rejects.toThrow()
    expect(shiftFindFirst).not.toHaveBeenCalled()
  })
})

describe('retimeShift', () => {
  // Bar staff: doors 8pm, starts 3.5h on (11:30pm), runs 5h (to 4:30am).
  const barStaff = (over: Record<string, unknown> = {}) => ({
    id: 'shift_bar',
    role: 'Bar staff',
    start: 3.5,
    hours: 5,
    hourEntry: null,
    event: { doors: '8:00pm' },
    ...over,
  })

  it("changes the shift's start and hours from new clock times", async () => {
    shiftFindFirst.mockResolvedValue(barStaff())

    const out = await retimeShift(EVENT, 'shift_bar', { start: '23:30', end: '05:00' })

    // Start unchanged (11:30pm still reads as 3.5h on); end pushed from
    // 4:30am to 5:00am, so the shift now runs 5.5h instead of 5.
    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: 'shift_bar' },
      data: { start: 3.5, hours: 5.5 },
    })
    expect(record).toHaveBeenCalledWith(EVENT, mere, expect.stringContaining('changed Bar staff'))
    expect(out.kind).toBe('good')
  })

  it("moves the linked hour entry's hours in the same transaction", async () => {
    shiftFindFirst.mockResolvedValue(barStaff({ hourEntry: { id: 'entry_1' } }))

    await retimeShift(EVENT, 'shift_bar', { start: '23:30', end: '05:00' })

    expect(entryUpdate).toHaveBeenCalledWith({ where: { id: 'entry_1' }, data: { hours: 5.5 } })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transaction.mock.calls[0][0]).toEqual([
      expect.objectContaining({ op: 'shift.update' }),
      expect.objectContaining({ op: 'hourEntry.update' }),
    ])
  })

  it('does not touch an hour entry that does not exist', async () => {
    shiftFindFirst.mockResolvedValue(barStaff())

    await retimeShift(EVENT, 'shift_bar', { start: '23:30', end: '05:00' })

    expect(entryUpdate).not.toHaveBeenCalled()
    expect(transaction.mock.calls[0][0]).toHaveLength(1)
  })

  it('refuses when the end resolves before the start, and writes nothing', async () => {
    shiftFindFirst.mockResolvedValue(barStaff())

    const out = await retimeShift(EVENT, 'shift_bar', { start: '02:00', end: '01:00' })

    expect(out.kind).toBe('stop')
    expect(out.text).toMatch(/end cannot be before the start/)
    expect(shiftUpdate).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('refuses when doors is not decided yet on the event', async () => {
    shiftFindFirst.mockResolvedValue(barStaff({ event: { doors: null } }))

    const out = await retimeShift(EVENT, 'shift_bar', { start: '20:00', end: '23:00' })

    expect(out.kind).toBe('stop')
    expect(shiftUpdate).not.toHaveBeenCalled()
  })

  it('refuses a malformed time', async () => {
    shiftFindFirst.mockResolvedValue(barStaff())

    const out = await retimeShift(EVENT, 'shift_bar', { start: '', end: '01:00' })

    expect(out.kind).toBe('stop')
    expect(shiftUpdate).not.toHaveBeenCalled()
  })

  it('refuses a shift that is not on this event, and writes nothing', async () => {
    shiftFindFirst.mockResolvedValue(null)

    const out = await retimeShift(EVENT, 'shift_elsewhere', { start: '20:00', end: '23:00' })

    expect(out.kind).toBe('stop')
    expect(shiftUpdate).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses an external account, and writes nothing', async () => {
    requireModuleMock.mockResolvedValueOnce({ user: external, modules: ['roster'] })

    const out = await retimeShift(EVENT, 'shift_bar', { start: '23:30', end: '05:00' })

    expect(out.kind).toBe('stop')
    expect(shiftFindFirst).not.toHaveBeenCalled()
  })

  it('propagates the module gate refusing anyone without the roster module', async () => {
    requireModuleMock.mockRejectedValueOnce(new Error('not found'))

    await expect(
      retimeShift(EVENT, 'shift_bar', { start: '23:30', end: '05:00' }),
    ).rejects.toThrow()
    expect(shiftFindFirst).not.toHaveBeenCalled()
  })
})

describe('duplicateShift', () => {
  it('creates an open copy with the same role, hours and call', async () => {
    shiftFindFirst.mockResolvedValue({ role: 'Set-up crew', hours: 0.75, start: -5 })

    const out = await duplicateShift(EVENT, 'shift_setup')

    expect(shiftCreate).toHaveBeenCalledWith({
      data: { eventId: EVENT, role: 'Set-up crew', hours: 0.75, start: -5, state: 'OPEN' },
    })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'duplicated Set-up crew')
    expect(out.kind).toBe('good')
  })

  it('creates no hour entry — nobody is on it yet', async () => {
    shiftFindFirst.mockResolvedValue({ role: 'Set-up crew', hours: 0.75, start: -5 })

    await duplicateShift(EVENT, 'shift_setup')

    // The previous test's exact toHaveBeenCalledWith already shows the create
    // carries no personId; this checks the other half of "no hour entry".
    expect(entryCreate).not.toHaveBeenCalled()
  })

  it('refuses a shift that is not on this event, and writes nothing', async () => {
    shiftFindFirst.mockResolvedValue(null)

    const out = await duplicateShift(EVENT, 'shift_elsewhere')

    expect(out.kind).toBe('stop')
    expect(shiftCreate).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses an external account, and writes nothing', async () => {
    requireModuleMock.mockResolvedValueOnce({ user: external, modules: ['roster'] })

    const out = await duplicateShift(EVENT, 'shift_setup')

    expect(out.kind).toBe('stop')
    expect(shiftFindFirst).not.toHaveBeenCalled()
  })

  it('propagates the module gate refusing anyone without the roster module', async () => {
    requireModuleMock.mockRejectedValueOnce(new Error('not found'))

    await expect(duplicateShift(EVENT, 'shift_setup')).rejects.toThrow()
    expect(shiftFindFirst).not.toHaveBeenCalled()
  })
})

describe('deleteShift', () => {
  it('deletes the shift and its hour entry together, in one transaction', async () => {
    shiftFindFirst.mockResolvedValue({
      id: 'shift_door',
      role: 'Door',
      hourEntry: { id: 'entry_1', paid: false },
    })

    const out = await deleteShift(EVENT, 'shift_door')

    expect(entryDelete).toHaveBeenCalledWith({ where: { id: 'entry_1' } })
    expect(shiftDelete).toHaveBeenCalledWith({ where: { id: 'shift_door' } })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transaction.mock.calls[0][0]).toEqual([
      expect.objectContaining({ op: 'hourEntry.delete' }),
      expect.objectContaining({ op: 'shift.delete' }),
    ])
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'deleted Door')
    expect(out.kind).toBe('good')
  })

  it('deletes a shift with no hour entry, untouched', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift_door', role: 'Door', hourEntry: null })

    await deleteShift(EVENT, 'shift_door')

    expect(entryDelete).not.toHaveBeenCalled()
    expect(shiftDelete).toHaveBeenCalledWith({ where: { id: 'shift_door' } })
    expect(transaction.mock.calls[0][0]).toHaveLength(1)
  })

  it('refuses when the linked hour entry is already paid, and writes nothing', async () => {
    shiftFindFirst.mockResolvedValue({
      id: 'shift_door',
      role: 'Door',
      hourEntry: { id: 'entry_1', paid: true },
    })

    const out = await deleteShift(EVENT, 'shift_door')

    expect(out.kind).toBe('stop')
    expect(entryDelete).not.toHaveBeenCalled()
    expect(shiftDelete).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses a shift that is not on this event, and writes nothing', async () => {
    shiftFindFirst.mockResolvedValue(null)

    const out = await deleteShift(EVENT, 'shift_elsewhere')

    expect(out.kind).toBe('stop')
    expect(shiftDelete).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses an external account, and writes nothing', async () => {
    requireModuleMock.mockResolvedValueOnce({ user: external, modules: ['roster'] })

    const out = await deleteShift(EVENT, 'shift_door')

    expect(out.kind).toBe('stop')
    expect(shiftFindFirst).not.toHaveBeenCalled()
  })

  it('propagates the module gate refusing anyone without the roster module', async () => {
    requireModuleMock.mockRejectedValueOnce(new Error('not found'))

    await expect(deleteShift(EVENT, 'shift_door')).rejects.toThrow()
    expect(shiftFindFirst).not.toHaveBeenCalled()
  })
})
