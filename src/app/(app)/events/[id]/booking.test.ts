import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventRecord } from '@/lib/event-record-data'
import type { NextMove } from '@/lib/parts'
import type { SessionUser } from '@/lib/session'

/**
 * The two moves on an event a person still makes by hand: moving the booking
 * on, and putting a counted night to bed. Every other part is worked out
 * from its records, so these are the only places a gate still refuses.
 *
 * The gates themselves are tested in parts.test.ts. This is about the
 * actions honouring them — re-reading the event rather than trusting the page
 * that drew the button, and refusing a press the page no longer describes.
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

// actions.ts now imports @/lib/grants-data (for issueArtistLink, moved here
// from Tech 23 Sep 2026), which imports 'server-only'. The real package
// throws outside a server-component build, so every test file that imports
// actions.ts for real needs this — see artist-link-actions.test.ts.
vi.mock('server-only', () => ({}))

vi.mock('@/lib/permissions', () => ({
  requireModule: vi.fn(async () => ({ user: mere, modules: ['pipeline'] })),
  requireEvent: vi.fn(async (_: unknown, id: string) => id),
}))

const loadEventRecord = vi.fn()
vi.mock('@/lib/event-record-data', () => ({
  loadEventRecord: (...a: unknown[]) => loadEventRecord(...a),
}))
vi.mock('@/lib/holds-data', () => ({}))

const updateMany = vi.fn()
const update = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    event: {
      updateMany: (...a: unknown[]) => updateMany(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}))

const record = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...a: unknown[]) => record(...a) }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))

const { advanceBooking, putToBed } = await import('./actions')

const EVENT = 'evt_wax_lyrical'

const gate = (label: string, ok: boolean) => ({ label, ok, why: '', screen: 'event' })

/** Just enough of a loaded record for the two actions. */
const rec = (over: Partial<EventRecord>): EventRecord =>
  ({ id: EVENT, booking: 'enquiry', concluded: false, next: null, ...over }) as EventRecord

const move = (over: Partial<NextMove>): NextMove & { gatesDone: string } => ({
  kind: 'booking',
  label: 'Move to Negotiating',
  title: 'Before this moves to Negotiating',
  gates: [gate('An owner is named', true)],
  clear: true,
  message: '',
  gatesDone: '',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  updateMany.mockResolvedValue({ count: 1 })
  update.mockResolvedValue({})
})

describe('moving the booking on', () => {
  it('moves a clear enquiry on to negotiating, and restarts its clock', async () => {
    loadEventRecord.mockResolvedValue(rec({ booking: 'enquiry', next: move({}) }))

    const out = await advanceBooking(EVENT, 'enquiry')

    expect(out.kind).toBe('good')
    expect(updateMany).toHaveBeenCalledOnce()
    const args = updateMany.mock.calls[0]![0]
    expect(args.where).toEqual({ id: EVENT, bookingStatus: 'ENQUIRY' })
    expect(args.data.bookingStatus).toBe('NEGOTIATING')
    expect(args.data.bookingStatusSince).toBeInstanceOf(Date)
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'moved the booking to Negotiating')
  })

  it('confirms a clear negotiation, and says tickets can now go on sale', async () => {
    loadEventRecord.mockResolvedValue(
      rec({ booking: 'negotiating', next: move({ label: 'Confirm the booking' }) }),
    )

    const out = await advanceBooking(EVENT, 'negotiating')

    expect(updateMany.mock.calls[0]![0].data.bookingStatus).toBe('CONFIRMED')
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'confirmed the booking')
    expect(out.text).toMatch(/tickets can go on sale/i)
  })

  it('refuses while a gate fails, naming the first one', async () => {
    loadEventRecord.mockResolvedValue(
      rec({
        booking: 'negotiating',
        next: move({
          clear: false,
          gates: [gate('Split agreed', false), gate('Bar close decided', false)],
        }),
      }),
    )

    const out = await advanceBooking(EVENT, 'negotiating')

    expect(out).toEqual({
      kind: 'stop',
      text: 'Still held up by 2 things, starting with split agreed.',
    })
    expect(updateMany).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  /**
   * A page opened at Enquiry says "Move to Negotiating". If somebody has
   * moved it on since, the same press must not confirm the booking — that
   * would put tickets one click away on the strength of a button that said
   * something else.
   */
  it('refuses a press from a page that is out of date, rather than moving it twice', async () => {
    loadEventRecord.mockResolvedValue(
      rec({ booking: 'negotiating', next: move({ label: 'Confirm the booking' }) }),
    )

    const out = await advanceBooking(EVENT, 'enquiry')

    expect(out.kind).toBe('warn')
    expect(out.text).toMatch(/Negotiating/)
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('does nothing to a booking somebody else moved in the same moment', async () => {
    loadEventRecord.mockResolvedValue(rec({ booking: 'enquiry', next: move({}) }))
    updateMany.mockResolvedValue({ count: 0 })

    const out = await advanceBooking(EVENT, 'enquiry')

    expect(out.kind).toBe('warn')
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses a booking that is already confirmed', async () => {
    loadEventRecord.mockResolvedValue(rec({ booking: 'confirmed', next: null }))

    const out = await advanceBooking(EVENT, 'confirmed')

    expect(out.kind).toBe('warn')
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('refuses an event this user cannot see', async () => {
    loadEventRecord.mockResolvedValue(null)
    expect((await advanceBooking(EVENT, 'enquiry')).kind).toBe('stop')
    expect(updateMany).not.toHaveBeenCalled()
  })
})

describe('putting a night to bed', () => {
  const settle = (over: Partial<NextMove> = {}) =>
    move({
      kind: 'settle',
      label: 'Put to bed',
      title: 'Before this is put to bed',
      gates: [gate('Hours logged for this event', true), gate('Actuals in', true)],
      ...over,
    })

  it('concludes a counted night', async () => {
    loadEventRecord.mockResolvedValue(rec({ booking: 'confirmed', next: settle() }))

    const out = await putToBed(EVENT)

    expect(out.kind).toBe('good')
    expect(update).toHaveBeenCalledWith({ where: { id: EVENT }, data: { concluded: true } })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'put this event to bed')
  })

  it('refuses while the night is not counted', async () => {
    loadEventRecord.mockResolvedValue(
      rec({
        booking: 'confirmed',
        next: settle({ clear: false, gates: [gate('Actuals in', false)] }),
      }),
    )

    const out = await putToBed(EVENT)

    expect(out).toEqual({ kind: 'stop', text: 'Still held up: actuals in.' })
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses before the night, when there is nothing to settle yet', async () => {
    loadEventRecord.mockResolvedValue(rec({ booking: 'confirmed', next: null }))
    expect((await putToBed(EVENT)).kind).toBe('warn')
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a booking that was never confirmed', async () => {
    loadEventRecord.mockResolvedValue(rec({ booking: 'negotiating', next: move({}) }))
    const out = await putToBed(EVENT)
    expect(out.kind).toBe('warn')
    expect(out.text).toMatch(/never confirmed/)
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses an event already put to bed', async () => {
    loadEventRecord.mockResolvedValue(rec({ booking: 'confirmed', concluded: true, next: null }))
    expect((await putToBed(EVENT)).kind).toBe('warn')
    expect(update).not.toHaveBeenCalled()
  })
})
