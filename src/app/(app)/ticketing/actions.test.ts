import { beforeEach, describe, expect, it, vi } from 'vitest'
import { said } from '@/lib/toast'

/**
 * `setTiers` replaces the old `setPrices` and `setMix` — one Save for the
 * tiers table now that the two forms are folded into it (T3). It has to
 * refuse exactly what those two refused: a bad price, and a mix that does
 * not make a whole. `db`, `permissions` and `activity` are mocked so this
 * runs with no database; `toast` and `ticketing` are the real modules, so
 * the checks here are against real validation, not a guess at their shape.
 */

const mocks = vi.hoisted(() => ({
  findUniqueOrThrow: vi.fn(),
  update: vi.fn(),
  record: vi.fn(),
  refresh: vi.fn(),
  requireModule: vi.fn(),
  requireEvent: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: { event: { findUniqueOrThrow: mocks.findUniqueOrThrow, update: mocks.update } },
}))
vi.mock('@/lib/activity', () => ({ record: mocks.record }))
vi.mock('@/lib/permissions', () => ({
  requireModule: mocks.requireModule,
  requireEvent: mocks.requireEvent,
}))
vi.mock('next/cache', () => ({ refresh: mocks.refresh }))

const { setTiers } = await import('./actions')

const EVENT_ID = 'evt_1'
const FAKE_USER = { id: 'user_1' } as never

/** A whole, valid four-way mix, fields named for the tiers table's rows. */
function tiersForm(
  fields: Partial<
    Record<'std' | 'door' | 'subShare' | 'stdShare' | 'supShare' | 'doorShare', string>
  >,
) {
  const form = new FormData()
  const defaults = {
    std: '30',
    door: '40',
    subShare: '15',
    stdShare: '50',
    supShare: '20',
    doorShare: '15',
  }
  for (const [k, v] of Object.entries({ ...defaults, ...fields })) form.set(k, v)
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireModule.mockResolvedValue({ user: FAKE_USER })
  mocks.requireEvent.mockResolvedValue(EVENT_ID)
  mocks.findUniqueOrThrow.mockResolvedValue({
    std: 30,
    door: 40,
    mix: [0.15, 0.5, 0.2, 0.15],
    name: 'Test night',
  })
})

describe('setTiers', () => {
  it('rejects a price that is not a number, or a negative one', async () => {
    expect(await setTiers(EVENT_ID, tiersForm({ std: 'abc' }))).toEqual(
      said('A price has to be a number, and not a negative one.', 'stop'),
    )
    expect(await setTiers(EVENT_ID, tiersForm({ door: '-5' }))).toEqual(
      said('A price has to be a number, and not a negative one.', 'stop'),
    )
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('rejects a price above the $500 ceiling', async () => {
    expect(await setTiers(EVENT_ID, tiersForm({ std: '501' }))).toEqual(
      said('500 is the ceiling. Above that is a typo more often than a price.', 'stop'),
    )
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('refuses a mix that is not a whole', async () => {
    const result = await setTiers(
      EVENT_ID,
      tiersForm({ subShare: '50', stdShare: '50', supShare: '50', doorShare: '50' }),
    )
    expect(result).toEqual(
      said('The four shares have to make a whole. These come to 200%.', 'stop'),
    )
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('saves a changed price and mix together, logging both the old and new figures', async () => {
    const result = await setTiers(
      EVENT_ID,
      tiersForm({ std: '32', subShare: '20', stdShare: '45', supShare: '20', doorShare: '15' }),
    )

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: EVENT_ID },
      data: { std: 32, door: 40, mix: [0.2, 0.45, 0.2, 0.15] },
    })
    expect(mocks.record).toHaveBeenCalledWith(
      EVENT_ID,
      FAKE_USER,
      expect.stringMatching(/standard.*\$30.*\$32/),
    )
    expect(mocks.record).toHaveBeenCalledWith(
      EVENT_ID,
      FAKE_USER,
      expect.stringMatching(/mix.*15\/50\/20\/15.*20\/45\/20\/15/),
    )
    expect(mocks.refresh).toHaveBeenCalled()
    expect(result.tone === 'stop' || result.tone === 'warn').toBe(false)
  })

  it('logs only the price when the mix has not changed', async () => {
    await setTiers(EVENT_ID, tiersForm({ door: '45' }))
    expect(mocks.record).toHaveBeenCalledTimes(1)
    expect(mocks.record).toHaveBeenCalledWith(
      EVENT_ID,
      FAKE_USER,
      expect.stringMatching(/door.*\$40.*\$45/),
    )
  })

  it('says nothing changed when the submission matches what is stored', async () => {
    const result = await setTiers(EVENT_ID, tiersForm({}))
    expect(result).toEqual(said('Nothing changed.', 'warn'))
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('scopes the event through requireEvent before touching it', async () => {
    await setTiers(EVENT_ID, tiersForm({ std: '35' }))
    expect(mocks.requireModule).toHaveBeenCalledWith('ticketing')
    expect(mocks.requireEvent).toHaveBeenCalledWith(FAKE_USER, EVENT_ID)
  })
})
