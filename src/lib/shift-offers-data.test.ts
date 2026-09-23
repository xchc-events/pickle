import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The database side of a shift offer: reading one back by its token, and the
 * confirm/decline transaction three different entry points share — the duty
 * manager's "Confirm now" in Roster, the offered person on Home, and the
 * emailed link at src/app/s/[token]. Each of those checks its own
 * permission first (see their own action files); this is what all three
 * fall through to once permission is settled, so it is tested once, here.
 */

vi.mock('server-only', () => ({}))

const shiftFindUnique = vi.fn()
const shiftUpdate = vi.fn((a: unknown) => ({ op: 'shift.update', a }))
const entryCreate = vi.fn((a: unknown) => ({ op: 'hourEntry.create', a }))
const entryUpdate = vi.fn((a: unknown) => ({ op: 'hourEntry.update', a }))
const offerUpdateMany = vi.fn((a: unknown) => ({ op: 'shiftOffer.updateMany', a }))
const offerFindUnique = vi.fn()
const transaction = vi.fn(async (ops: unknown[]) => ops)

vi.mock('./db', () => ({
  db: {
    shift: {
      findUnique: (...a: unknown[]) => shiftFindUnique(...a),
      update: (a: unknown) => shiftUpdate(a),
    },
    hourEntry: {
      create: (a: unknown) => entryCreate(a),
      update: (a: unknown) => entryUpdate(a),
    },
    shiftOffer: {
      updateMany: (a: unknown) => offerUpdateMany(a),
      findUnique: (...a: unknown[]) => offerFindUnique(...a),
    },
    $transaction: (ops: unknown[]) => transaction(ops),
  },
}))

const recordAs = vi.fn()
vi.mock('./activity', () => ({ recordAs: (...a: unknown[]) => recordAs(...a) }))

const { confirmOfferedShift, declineOfferedShift, resolveShiftOfferToken } =
  await import('./shift-offers-data')

const EVENT = 'evt_static_bloom'
const NIGHT = new Date(2026, 9, 10, 12)
const ACTOR = { personId: 'user_mere_person', who: 'MT' }

const offeredShift = (over: Record<string, unknown> = {}) => ({
  id: 'shift_door',
  eventId: EVENT,
  role: 'Door',
  hours: 6,
  state: 'OFFERED',
  personId: 'person_ari',
  hourEntry: null,
  event: { date: NIGHT },
  person: { id: 'person_ari', name: 'Ari Ngata' },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('confirmOfferedShift', () => {
  it('books the hours — the same shape assignShift always wrote', async () => {
    shiftFindUnique.mockResolvedValue(offeredShift())

    const out = await confirmOfferedShift('shift_door', ACTOR)

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
    expect(out.kind).toBe('good')
  })

  it('moves the shift to ASSIGNED', async () => {
    shiftFindUnique.mockResolvedValue(offeredShift())

    await confirmOfferedShift('shift_door', ACTOR)

    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: 'shift_door' },
      data: { state: 'ASSIGNED' },
    })
  })

  it('updates the linked hour entry instead of creating a second one, when it already exists', async () => {
    shiftFindUnique.mockResolvedValue(offeredShift({ hourEntry: { id: 'entry_1' } }))

    await confirmOfferedShift('shift_door', ACTOR)

    expect(entryCreate).not.toHaveBeenCalled()
    expect(entryUpdate).toHaveBeenCalledWith({
      where: { id: 'entry_1' },
      data: { personId: 'person_ari', hours: 6, eventId: EVENT, workedOn: NIGHT },
    })
  })

  it('marks any unresponded offer on this shift as confirmed, in the same transaction', async () => {
    shiftFindUnique.mockResolvedValue(offeredShift())

    await confirmOfferedShift('shift_door', ACTOR)

    expect(offerUpdateMany).toHaveBeenCalledWith({
      where: { shiftId: 'shift_door', personId: 'person_ari', respondedAt: null },
      data: { respondedAt: expect.any(Date), response: 'CONFIRMED' },
    })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(transaction.mock.calls[0][0]).toEqual([
      expect.objectContaining({ op: 'shift.update' }),
      expect.objectContaining({ op: 'hourEntry.create' }),
      expect.objectContaining({ op: 'shiftOffer.updateMany' }),
    ])
  })

  it('writes an activity line naming the person and the role', async () => {
    shiftFindUnique.mockResolvedValue(offeredShift())

    await confirmOfferedShift('shift_door', ACTOR)

    expect(recordAs).toHaveBeenCalledWith(EVENT, ACTOR, expect.stringContaining('Ari Ngata'))
    expect(recordAs).toHaveBeenCalledWith(EVENT, ACTOR, expect.stringContaining('Door'))
  })

  it('a token confirms once only — a shift no longer OFFERED refuses, and writes nothing', async () => {
    shiftFindUnique.mockResolvedValue(offeredShift({ state: 'ASSIGNED' }))

    const out = await confirmOfferedShift('shift_door', ACTOR)

    expect(out.kind).toBe('stop')
    expect(transaction).not.toHaveBeenCalled()
    expect(recordAs).not.toHaveBeenCalled()
  })

  it('refuses a shift that does not exist, and writes nothing', async () => {
    shiftFindUnique.mockResolvedValue(null)

    const out = await confirmOfferedShift('shift_gone', ACTOR)

    expect(out.kind).toBe('stop')
    expect(transaction).not.toHaveBeenCalled()
    expect(recordAs).not.toHaveBeenCalled()
  })
})

describe('declineOfferedShift', () => {
  it('clears the person and reopens the shift', async () => {
    shiftFindUnique.mockResolvedValue(offeredShift())

    const out = await declineOfferedShift('shift_door', ACTOR)

    expect(shiftUpdate).toHaveBeenCalledWith({
      where: { id: 'shift_door' },
      data: { personId: null, state: 'OPEN' },
    })
    expect(out.kind).toBe('warn')
  })

  it('books no hours', async () => {
    shiftFindUnique.mockResolvedValue(offeredShift())

    await declineOfferedShift('shift_door', ACTOR)

    expect(entryCreate).not.toHaveBeenCalled()
    expect(entryUpdate).not.toHaveBeenCalled()
  })

  it('marks any unresponded offer on this shift as declined', async () => {
    shiftFindUnique.mockResolvedValue(offeredShift())

    await declineOfferedShift('shift_door', ACTOR)

    expect(offerUpdateMany).toHaveBeenCalledWith({
      where: { shiftId: 'shift_door', personId: 'person_ari', respondedAt: null },
      data: { respondedAt: expect.any(Date), response: 'DECLINED' },
    })
  })

  it('writes an activity line naming who declined, since the person is about to be cleared', async () => {
    shiftFindUnique.mockResolvedValue(offeredShift())

    await declineOfferedShift('shift_door', ACTOR)

    expect(recordAs).toHaveBeenCalledWith(EVENT, ACTOR, expect.stringContaining('Ari Ngata'))
  })

  it('refuses a shift that is not OFFERED, and writes nothing', async () => {
    shiftFindUnique.mockResolvedValue(offeredShift({ state: 'ASSIGNED' }))

    const out = await declineOfferedShift('shift_door', ACTOR)

    expect(out.kind).toBe('stop')
    expect(shiftUpdate).not.toHaveBeenCalled()
    expect(recordAs).not.toHaveBeenCalled()
  })
})

describe('resolveShiftOfferToken', () => {
  const NOW = new Date('2026-09-24T00:00:00Z')

  const row = (over: Record<string, unknown> = {}) => ({
    personId: 'person_ari',
    expires: new Date('2026-09-30T00:00:00Z'),
    respondedAt: null,
    response: null,
    shift: {
      role: 'Door',
      hours: 6,
      start: 0,
      state: 'OFFERED',
      personId: 'person_ari',
      event: { name: 'Static Bloom', date: NIGHT },
    },
    person: { name: 'Ari Ngata' },
    ...over,
  })

  it('reads back a live offer by hashing the token, never storing it in the clear', async () => {
    offerFindUnique.mockResolvedValue(row())

    const view = await resolveShiftOfferToken('a-token-value', NOW)

    expect(offerFindUnique.mock.calls[0][0].where.tokenHash).not.toBe('a-token-value')
    expect(view?.live).toBe(true)
    expect(view?.role).toBe('Door')
    expect(view?.personName).toBe('Ari Ngata')
  })

  it('is null for a token nothing matches — not found, not "expired"', async () => {
    offerFindUnique.mockResolvedValue(null)

    expect(await resolveShiftOfferToken('nothing-like-it', NOW)).toBeNull()
  })

  it('says so, rather than rendering live, for a spent token', async () => {
    offerFindUnique.mockResolvedValue(row({ respondedAt: NOW, response: 'CONFIRMED' }))

    const view = await resolveShiftOfferToken('a-token-value', NOW)

    expect(view?.live).toBe(false)
    expect(view?.message).toMatch(/already confirmed/i)
  })

  it('says so for an expired token', async () => {
    offerFindUnique.mockResolvedValue(row({ expires: new Date('2026-09-01') }))

    const view = await resolveShiftOfferToken('a-token-value', NOW)

    expect(view?.live).toBe(false)
    expect(view?.message).toMatch(/expired/i)
  })
})
