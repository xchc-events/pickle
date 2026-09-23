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
const offerCreate = vi.fn()
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
    shiftOffer: { create: (a: unknown) => offerCreate(a) },
    $transaction: (ops: unknown[]) => transaction(ops),
  },
}))

const record = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...a: unknown[]) => record(...a) }))

const refresh = vi.fn()
vi.mock('next/cache', () => ({ refresh: () => refresh() }))

const confirmOfferedShift = vi.fn()
const declineOfferedShift = vi.fn()
vi.mock('@/lib/shift-offers-data', () => ({
  confirmOfferedShift: (...a: unknown[]) => confirmOfferedShift(...a),
  declineOfferedShift: (...a: unknown[]) => declineOfferedShift(...a),
}))

vi.mock('@/lib/shift-offers', () => ({
  shiftOfferExpiryFrom: () => new Date('2026-09-30T00:00:00Z'),
}))

vi.mock('@/lib/grants', () => ({
  mintToken: () => 'raw-token-value',
  hashToken: (t: string) => `hashed:${t}`,
}))

const shiftOfferEmail = vi.fn<(a: unknown) => { subject: string; text: string; html: string }>(
  () => ({ subject: 's', text: 't', html: 'h' }),
)
vi.mock('@/lib/shift-offer-email', () => ({
  shiftOfferEmail: (a: unknown) => shiftOfferEmail(a),
}))

const sendMail = vi.fn()
vi.mock('@/lib/email', () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }))

const linkBase = vi.fn<(...a: unknown[]) => string | null>(() => 'https://pickle.example')
vi.mock('@/lib/auth-rules', () => ({ linkBase: (...a: unknown[]) => linkBase(...a) }))

vi.mock('@/lib/format', () => ({ dateLabel: () => '10 October 2026' }))

const {
  askAgain,
  confirmOffer,
  declineOffer,
  deleteShift,
  duplicateShift,
  emailOffer,
  offerShift,
  renameShift,
  retimeShift,
} = await import('./actions')

const EVENT = 'evt_static_bloom'
const NIGHT = new Date(2026, 9, 10, 12)

const shift = (over: { hourEntry?: { id: string; paid?: boolean } | null } = {}) => ({
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
  shiftOfferEmail.mockReturnValue({ subject: 's', text: 't', html: 'h' })
  linkBase.mockReturnValue('https://pickle.example')
})

const external = {
  ...mere,
  id: 'user_amy',
  external: true,
  initials: 'AP',
} satisfies SessionUser

describe('offerShift', () => {
  it('reads the shift, scoped to the event', async () => {
    shiftFindFirst.mockResolvedValue(shift())

    await offerShift(EVENT, 'shift_door', 'person_ari')

    expect(shiftFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'shift_door', eventId: EVENT } }),
    )
  })

  it('offers no hours — the shift moves to OFFERED with nothing booked', async () => {
    shiftFindFirst.mockResolvedValue(shift())

    const out = await offerShift(EVENT, 'shift_door', 'person_ari')

    expect(out.kind).toBe('good')
    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: 'shift_door' },
      data: { personId: 'person_ari', state: 'OFFERED' },
    })
    expect(entryCreate).not.toHaveBeenCalled()
    expect(entryUpdate).not.toHaveBeenCalled()
  })

  it('writes an activity line naming who it was offered to', async () => {
    shiftFindFirst.mockResolvedValue(shift())

    await offerShift(EVENT, 'shift_door', 'person_ari')

    expect(record).toHaveBeenCalledWith(EVENT, mere, 'offered Door to Ari Ngata')
  })

  it('clears any hold-over hour entry rather than moving it — an offer starts clean', async () => {
    shiftFindFirst.mockResolvedValue(shift({ hourEntry: { id: 'entry_1' } }))

    await offerShift(EVENT, 'shift_door', 'person_ari')

    expect(entryDelete).toHaveBeenCalledWith({ where: { id: 'entry_1' } })
    expect(entryUpdate).not.toHaveBeenCalled()
    expect(entryCreate).not.toHaveBeenCalled()
  })

  it('writes the shift update and the hour entry delete in one transaction', async () => {
    shiftFindFirst.mockResolvedValue(shift({ hourEntry: { id: 'entry_1' } }))

    await offerShift(EVENT, 'shift_door', 'person_ari')

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transaction.mock.calls[0][0]).toEqual([
      expect.objectContaining({ op: 'hourEntry.delete' }),
      expect.objectContaining({ op: 'shift.update' }),
    ])
  })

  it('takes the hours off the event when the shift goes back to open', async () => {
    shiftFindFirst.mockResolvedValue(shift({ hourEntry: { id: 'entry_1' } }))

    const out = await offerShift(EVENT, 'shift_door', '')

    expect(entryDelete).toHaveBeenCalledWith({ where: { id: 'entry_1' } })
    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: 'shift_door' },
      data: { personId: null, state: 'OPEN' },
    })
    expect(out.kind).toBe('warn')
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'took Door back to open')
  })

  it('refuses to move a paid wage by picking somebody else, and writes nothing', async () => {
    shiftFindFirst.mockResolvedValue(shift({ hourEntry: { id: 'entry_1', paid: true } }))

    const out = await offerShift(EVENT, 'shift_door', 'person_ari')

    expect(out.kind).toBe('stop')
    expect(out.text).toMatch(/already paid/)
    expect(transaction).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses a shift that is not on this event, and writes nothing', async () => {
    shiftFindFirst.mockResolvedValue(null)

    const out = await offerShift(EVENT, 'shift_elsewhere', 'person_ari')

    expect(out.kind).toBe('stop')
    expect(transaction).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses somebody who does not work here, and writes nothing', async () => {
    shiftFindFirst.mockResolvedValue(shift())
    personFindFirst.mockResolvedValue(null)

    const out = await offerShift(EVENT, 'shift_door', 'person_gone')

    expect(out.kind).toBe('stop')
    expect(transaction).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses an external account, and writes nothing', async () => {
    requireModuleMock.mockResolvedValueOnce({ user: external, modules: ['roster'] })

    const out = await offerShift(EVENT, 'shift_door', 'person_ari')

    expect(out.kind).toBe('stop')
    expect(shiftFindFirst).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('propagates the module gate refusing anyone without the roster module', async () => {
    requireModuleMock.mockRejectedValueOnce(new Error('not found'))

    await expect(offerShift(EVENT, 'shift_door', 'person_ari')).rejects.toThrow()
    expect(shiftFindFirst).not.toHaveBeenCalled()
  })
})

describe('confirmOffer — the duty manager confirming in the room', () => {
  it('scopes the shift to the event before handing off, and delegates the actual confirm', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift_door' })
    confirmOfferedShift.mockResolvedValue({ kind: 'good', text: 'Ari Ngata is on Door.' })

    const out = await confirmOffer(EVENT, 'shift_door')

    expect(shiftFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'shift_door', eventId: EVENT } }),
    )
    expect(confirmOfferedShift).toHaveBeenCalledWith('shift_door', {
      personId: mere.personId,
      who: mere.initials,
    })
    expect(out.text).toBe('Ari Ngata is on Door.')
    expect(refresh).toHaveBeenCalled()
  })

  it('refuses a shift that is not on this event, without calling through', async () => {
    shiftFindFirst.mockResolvedValue(null)

    const out = await confirmOffer(EVENT, 'shift_elsewhere')

    expect(out.kind).toBe('stop')
    expect(confirmOfferedShift).not.toHaveBeenCalled()
  })

  it('refuses an external account', async () => {
    requireModuleMock.mockResolvedValueOnce({ user: external, modules: ['roster'] })

    const out = await confirmOffer(EVENT, 'shift_door')

    expect(out.kind).toBe('stop')
    expect(shiftFindFirst).not.toHaveBeenCalled()
    expect(confirmOfferedShift).not.toHaveBeenCalled()
  })

  it('propagates the module gate refusing anyone without the roster module', async () => {
    requireModuleMock.mockRejectedValueOnce(new Error('not found'))

    await expect(confirmOffer(EVENT, 'shift_door')).rejects.toThrow()
    expect(confirmOfferedShift).not.toHaveBeenCalled()
  })
})

describe('declineOffer — the duty manager recording a no', () => {
  it('scopes the shift to the event before handing off, and delegates the actual decline', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift_door' })
    declineOfferedShift.mockResolvedValue({ kind: 'warn', text: 'Door is open again.' })

    const out = await declineOffer(EVENT, 'shift_door')

    expect(declineOfferedShift).toHaveBeenCalledWith('shift_door', {
      personId: mere.personId,
      who: mere.initials,
    })
    expect(out.text).toBe('Door is open again.')
    expect(refresh).toHaveBeenCalled()
  })

  it('refuses a shift that is not on this event, without calling through', async () => {
    shiftFindFirst.mockResolvedValue(null)

    const out = await declineOffer(EVENT, 'shift_elsewhere')

    expect(out.kind).toBe('stop')
    expect(declineOfferedShift).not.toHaveBeenCalled()
  })

  it('refuses an external account', async () => {
    requireModuleMock.mockResolvedValueOnce({ user: external, modules: ['roster'] })

    const out = await declineOffer(EVENT, 'shift_door')

    expect(out.kind).toBe('stop')
    expect(declineOfferedShift).not.toHaveBeenCalled()
  })
})

describe('emailOffer', () => {
  const offeredShift = (over: Record<string, unknown> = {}) => ({
    id: 'shift_door',
    eventId: EVENT,
    role: 'Door',
    hours: 6,
    start: 3.5,
    state: 'OFFERED',
    person: { id: 'person_ari', name: 'Ari Ngata', email: 'ari@xchc.test' },
    event: { name: 'Static Bloom', date: NIGHT, doors: null },
    ...over,
  })

  it('mints a token, stores only its hash, and mails the live one', async () => {
    shiftFindFirst.mockResolvedValue(offeredShift())

    const out = await emailOffer(EVENT, 'shift_door')

    expect(offerCreate).toHaveBeenCalledWith({
      data: {
        shiftId: 'shift_door',
        personId: 'person_ari',
        tokenHash: 'hashed:raw-token-value',
        expires: new Date('2026-09-30T00:00:00Z'),
      },
    })
    expect(sendMail).toHaveBeenCalledWith('ari@xchc.test', { subject: 's', text: 't', html: 'h' })
    expect(shiftOfferEmail).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://pickle.example/s/raw-token-value' }),
    )
    expect(out.kind).toBe('good')
  })

  it('falls back to the hours alone when doors is not decided yet', async () => {
    shiftFindFirst.mockResolvedValue(offeredShift({ event: { name: 'Static Bloom', date: NIGHT, doors: null } }))

    await emailOffer(EVENT, 'shift_door')

    expect(shiftOfferEmail).toHaveBeenCalledWith(expect.objectContaining({ times: null, hours: 6 }))
  })

  it('carries clock times once doors is decided', async () => {
    // Doors 8pm, start 3.5h on (11:30pm), runs 6h — the same doors/start
    // fixture retimeShift's own tests use, so the conversion is already
    // proven correct; only the length differs (6h here, ending 5:30am).
    shiftFindFirst.mockResolvedValue(
      offeredShift({ event: { name: 'Static Bloom', date: NIGHT, doors: '8:00pm' } }),
    )

    await emailOffer(EVENT, 'shift_door')

    expect(shiftOfferEmail).toHaveBeenCalledWith(expect.objectContaining({ times: '11:30pm–5:30am' }))
  })

  it('writes an activity line naming who it was emailed to', async () => {
    shiftFindFirst.mockResolvedValue(offeredShift())

    await emailOffer(EVENT, 'shift_door')

    expect(record).toHaveBeenCalledWith(EVENT, mere, 'emailed the offer for Door to Ari Ngata')
  })

  it('refuses, naming them, when the person has no email on file', async () => {
    shiftFindFirst.mockResolvedValue(offeredShift({ person: { id: 'person_ari', name: 'Ari Ngata', email: null } }))

    const out = await emailOffer(EVENT, 'shift_door')

    expect(out.kind).toBe('stop')
    expect(out.text).toMatch(/Ari Ngata/)
    expect(out.text).toMatch(/no email/)
    expect(sendMail).not.toHaveBeenCalled()
    expect(offerCreate).not.toHaveBeenCalled()
  })

  it('refuses a shift that is not OFFERED', async () => {
    shiftFindFirst.mockResolvedValue(offeredShift({ state: 'ASSIGNED' }))

    const out = await emailOffer(EVENT, 'shift_door')

    expect(out.kind).toBe('stop')
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('refuses when the app has no configured address to send a link to', async () => {
    linkBase.mockReturnValue(null)
    shiftFindFirst.mockResolvedValue(offeredShift())

    const out = await emailOffer(EVENT, 'shift_door')

    expect(out.kind).toBe('stop')
    expect(sendMail).not.toHaveBeenCalled()
    expect(offerCreate).not.toHaveBeenCalled()
  })

  it('refuses an external account, and writes nothing', async () => {
    requireModuleMock.mockResolvedValueOnce({ user: external, modules: ['roster'] })

    const out = await emailOffer(EVENT, 'shift_door')

    expect(out.kind).toBe('stop')
    expect(shiftFindFirst).not.toHaveBeenCalled()
  })
})

describe('askAgain, once a shift has been offered', () => {
  it('refuses to ask around again while somebody specific is offered it', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift_door', role: 'Door', asked: 0, state: 'OFFERED' })

    const out = await askAgain(EVENT, 'shift_door')

    expect(out.kind).toBe('warn')
    expect(shiftUpdate).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })
})

describe('renameShift', () => {
  it('renames the role and writes an activity line', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift_door', role: 'Door', hourEntry: null })

    const out = await renameShift(EVENT, 'shift_door', 'Door (extra)')

    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: 'shift_door' },
      data: { role: 'Door (extra)' },
    })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'renamed Door to Door (extra)')
    expect(out.kind).toBe('good')
  })

  it('keeps everything else on the shift, only the role is in the shift update', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift_door', role: 'Door', hourEntry: null })

    await renameShift(EVENT, 'shift_door', 'Front door')

    // toHaveBeenCalledWith is an exact match, so this alone proves the
    // shift's own update data carries nothing besides the new role.
    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: 'shift_door' },
      data: { role: 'Front door' },
    })
    expect(entryUpdate).not.toHaveBeenCalled()
    expect(entryDelete).not.toHaveBeenCalled()
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transaction.mock.calls[0][0]).toHaveLength(1)
  })

  it("moves the linked hour entry's note when it still matched the old role", async () => {
    shiftFindFirst.mockResolvedValue({
      id: 'shift_door',
      role: 'Door',
      hourEntry: { id: 'entry_1', note: 'Door' },
    })

    await renameShift(EVENT, 'shift_door', 'Front door')

    expect(entryUpdate).toHaveBeenCalledWith({
      where: { id: 'entry_1' },
      data: { note: 'Front door' },
    })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transaction.mock.calls[0][0]).toEqual([
      expect.objectContaining({ op: 'shift.update' }),
      expect.objectContaining({ op: 'hourEntry.update' }),
    ])
  })

  it('leaves a hand-edited note alone', async () => {
    shiftFindFirst.mockResolvedValue({
      id: 'shift_door',
      role: 'Door',
      hourEntry: { id: 'entry_1', note: 'Door (covering for Amy)' },
    })

    const out = await renameShift(EVENT, 'shift_door', 'Front door')

    expect(entryUpdate).not.toHaveBeenCalled()
    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: 'shift_door' },
      data: { role: 'Front door' },
    })
    expect(out.kind).toBe('good')
  })

  it('trims the name and does nothing when it has not actually changed', async () => {
    shiftFindFirst.mockResolvedValue({ id: 'shift_door', role: 'Door', hourEntry: null })

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
    shiftFindFirst.mockResolvedValue(barStaff({ hourEntry: { id: 'entry_1', paid: false } }))

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

  it('refuses when the linked hour entry is already paid, and writes nothing', async () => {
    shiftFindFirst.mockResolvedValue(barStaff({ hourEntry: { id: 'entry_1', paid: true } }))

    const out = await retimeShift(EVENT, 'shift_bar', { start: '23:30', end: '05:00' })

    expect(out.kind).toBe('stop')
    expect(out.text).toMatch(/already paid/)
    expect(shiftUpdate).not.toHaveBeenCalled()
    expect(entryUpdate).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
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
