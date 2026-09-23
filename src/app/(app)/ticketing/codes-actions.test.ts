import { beforeEach, describe, expect, it, vi } from 'vitest'
import { said } from '@/lib/toast'

/**
 * `addCode` and `deactivateCode` — T6. Venue only: an external promoter can
 * see this page for their own events, but codes are the venue's own lever,
 * refused the same way `setOrganisation` refuses one in admin/actions.ts.
 * `db`, `permissions` and `activity` are mocked so this runs with no
 * database; `toast` and `ticket-codes` are the real modules.
 */

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  record: vi.fn(),
  refresh: vi.fn(),
  requireModule: vi.fn(),
  requireEvent: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    ticketCode: {
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
      create: mocks.create,
      update: mocks.update,
    },
  },
}))
vi.mock('@/lib/activity', () => ({ record: mocks.record }))
vi.mock('@/lib/permissions', () => ({
  requireModule: mocks.requireModule,
  requireEvent: mocks.requireEvent,
}))
vi.mock('next/cache', () => ({ refresh: mocks.refresh }))

const { addCode, deactivateCode } = await import('./codes-actions')

const EVENT_ID = 'evt_1'
const INTERNAL_USER = { id: 'user_1', name: 'Mere Tapu', external: false } as never
const EXTERNAL_USER = { id: 'user_2', name: 'Awhina Reid', external: true } as never

function codeForm(
  fields: Partial<
    Record<'code' | 'kind' | 'value' | 'tierKey' | 'useLimit' | 'activeFrom' | 'activeTo', string>
  >,
) {
  const form = new FormData()
  const defaults = { code: 'locals', kind: 'PERCENT_OFF', value: '10' }
  for (const [k, v] of Object.entries({ ...defaults, ...fields })) form.set(k, v)
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireModule.mockResolvedValue({ user: INTERNAL_USER })
  mocks.requireEvent.mockResolvedValue(EVENT_ID)
  mocks.findUnique.mockResolvedValue(null)
})

describe('addCode', () => {
  it('refuses an external account before touching the database', async () => {
    mocks.requireModule.mockResolvedValue({ user: EXTERNAL_USER })
    const result = await addCode(EVENT_ID, codeForm({}))
    expect(result).toEqual(said('Not something an external account can do.', 'stop'))
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('refuses an invalid code and does not touch the database', async () => {
    const result = await addCode(EVENT_ID, codeForm({ value: '150' }))
    expect(result.kind).toBe('stop')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('refuses a code that already exists on this event', async () => {
    mocks.findUnique.mockResolvedValue({ id: 'existing' })
    const result = await addCode(EVENT_ID, codeForm({}))
    expect(result).toEqual(said('LOCALS is already a code on this event.', 'stop'))
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('creates a code normalised to upper case, and logs it', async () => {
    const result = await addCode(EVENT_ID, codeForm({ code: ' locals ' }))
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: EVENT_ID,
        code: 'LOCALS',
        kind: 'PERCENT_OFF',
        value: 10,
        tierKey: null,
        useLimit: null,
        createdById: 'user_1',
        who: 'Mere Tapu',
      }),
    })
    expect(mocks.record).toHaveBeenCalledWith(
      EVENT_ID,
      INTERNAL_USER,
      expect.stringMatching(/LOCALS/),
    )
    expect(mocks.refresh).toHaveBeenCalled()
    expect(result.kind).toBe('good')
  })

  it('refuses an end date before the start date', async () => {
    const result = await addCode(
      EVENT_ID,
      codeForm({ activeFrom: '2026-10-10', activeTo: '2026-10-01' }),
    )
    expect(result.kind).toBe('stop')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('scopes the event through requireEvent before touching it', async () => {
    await addCode(EVENT_ID, codeForm({}))
    expect(mocks.requireModule).toHaveBeenCalledWith('ticketing')
    expect(mocks.requireEvent).toHaveBeenCalledWith(INTERNAL_USER, EVENT_ID)
  })
})

describe('deactivateCode', () => {
  it('refuses an external account before touching the database', async () => {
    mocks.requireModule.mockResolvedValue({ user: EXTERNAL_USER })
    const result = await deactivateCode(EVENT_ID, 'code_1')
    expect(result).toEqual(said('Not something an external account can do.', 'stop'))
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('refuses a code that is not on this event', async () => {
    mocks.findFirst.mockResolvedValue(null)
    const result = await deactivateCode(EVENT_ID, 'code_1')
    expect(result.kind).toBe('stop')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('says so, rather than writing anything, when a code is already off', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'code_1', code: 'LOCALS', active: false })
    const result = await deactivateCode(EVENT_ID, 'code_1')
    expect(result).toEqual(said('LOCALS is already off.', 'warn'))
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('deactivates an active code and logs it', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'code_1', code: 'LOCALS', active: true })
    const result = await deactivateCode(EVENT_ID, 'code_1')
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'code_1' },
      data: { active: false },
    })
    expect(mocks.record).toHaveBeenCalledWith(
      EVENT_ID,
      INTERNAL_USER,
      expect.stringMatching(/LOCALS/),
    )
    expect(mocks.refresh).toHaveBeenCalled()
    expect(result.kind).toBe('good')
  })
})
