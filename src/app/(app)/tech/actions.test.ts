import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

/**
 * Tech's per-act mutations.
 *
 * Connor, 23 Sep 2026: "The only details we want to see here are tech riders
 * and stage plots. These two want to be per artist, and you can have a
 * section for the promoter as well." An `artistId` a caller supplies is
 * re-checked against the event the same way `eventId` itself is — a POST
 * endpoint has to survive being asked about somebody else's act.
 */

const requireModule = vi.fn()
const requireEvent = vi.fn()
vi.mock('@/lib/permissions', () => ({
  requireModule: (...a: unknown[]) => requireModule(...a),
  requireEvent: (...a: unknown[]) => requireEvent(...a),
}))

const findArtist = vi.fn()
const findFile = vi.fn()
const findEvent = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    eventArtist: { findUnique: (...a: unknown[]) => findArtist(...a) },
    storedFile: { findUnique: (...a: unknown[]) => findFile(...a) },
    event: { findUniqueOrThrow: (...a: unknown[]) => findEvent(...a) },
  },
}))

const begin = vi.fn()
const attachToArtist = vi.fn()
vi.mock('@/lib/files-data', () => ({
  begin: (...a: unknown[]) => begin(...a),
  attachToArtist: (...a: unknown[]) => attachToArtist(...a),
}))

const record = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...a: unknown[]) => record(...a) }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))

const { beginTechUpload, beginPromoterUpload, assignFileToArtist } = await import('./actions')

const tui = {
  id: 'user_tui',
  email: 'tui@xchc.test',
  name: 'Tui Ware',
  role: 'TECH',
  roleKey: 'tech',
  organisationId: null,
  organisationName: null,
  external: false,
  personId: 'person_tui',
  initials: 'TW',
  authenticated: true,
  sessionId: 'session_tui',
} satisfies SessionUser

const EVENT = 'evt_wax_lyrical'
const OTHER_EVENT = 'evt_other'

beforeEach(() => {
  vi.clearAllMocks()
  requireModule.mockResolvedValue({ user: tui, modules: ['tech'] })
  requireEvent.mockResolvedValue(EVENT)
  begin.mockResolvedValue({ ok: true, fileId: 'file_1', url: 'https://r2.example/put' })
})

describe('starting an act’s rider or stage plot', () => {
  it('passes the act straight through once it checks out', async () => {
    findArtist.mockResolvedValue({ eventId: EVENT })

    const out = await beginTechUpload(EVENT, 'RIDER_TECH', 'art_1', 'rider.pdf', 'application/pdf', 1024)

    expect(out.ok).toBe(true)
    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: EVENT, artistId: 'art_1', kind: 'RIDER_TECH' }),
    )
  })

  it('refuses an act that belongs to a different event', async () => {
    findArtist.mockResolvedValue({ eventId: OTHER_EVENT })

    const out = await beginTechUpload(EVENT, 'RIDER_TECH', 'art_1', 'rider.pdf', 'application/pdf', 1024)

    expect(out.ok).toBe(false)
    expect(out.why).toMatch(/not on this event/)
    expect(begin).not.toHaveBeenCalled()
  })

  it('refuses an act id that does not exist at all', async () => {
    findArtist.mockResolvedValue(null)

    const out = await beginTechUpload(EVENT, 'RIDER_TECH', 'art_ghost', 'rider.pdf', 'application/pdf', 1024)

    expect(out.ok).toBe(false)
    expect(begin).not.toHaveBeenCalled()
  })

  it('needs no act at all for the venue spec', async () => {
    const out = await beginTechUpload(EVENT, 'TECH_SPEC', null, 'spec.pdf', 'application/pdf', 1024)

    expect(out.ok).toBe(true)
    expect(findArtist).not.toHaveBeenCalled()
    expect(begin).toHaveBeenCalledWith(expect.objectContaining({ artistId: null }))
  })
})

describe('starting the promoter’s own upload', () => {
  it('files it against the event’s promoter payee', async () => {
    findEvent.mockResolvedValue({ promoterId: 'pay_promo' })

    const out = await beginPromoterUpload(EVENT, 'RIDER_TECH', 'rider.pdf', 'application/pdf', 1024)

    expect(out.ok).toBe(true)
    expect(begin).toHaveBeenCalledWith(expect.objectContaining({ payeeId: 'pay_promo', eventId: EVENT }))
  })

  it('refuses when the event has no promoter payee to file it against', async () => {
    findEvent.mockResolvedValue({ promoterId: null })

    const out = await beginPromoterUpload(EVENT, 'RIDER_TECH', 'rider.pdf', 'application/pdf', 1024)

    expect(out.ok).toBe(false)
    expect(begin).not.toHaveBeenCalled()
  })
})

describe('attaching an unassigned file to an act', () => {
  it('writes the act once both check out', async () => {
    findFile.mockResolvedValue({ eventId: EVENT, name: 'rider.pdf' })
    findArtist.mockResolvedValue({ eventId: EVENT, name: 'Static Bloom' })
    attachToArtist.mockResolvedValue({ ok: true })

    const out = await assignFileToArtist(EVENT, 'file_1', 'art_1')

    expect(out.kind).toBe('good')
    expect(attachToArtist).toHaveBeenCalledWith('file_1', 'art_1')
    expect(record).toHaveBeenCalledWith(EVENT, tui, expect.stringContaining('Static Bloom'))
  })

  it('refuses a file that is not on this event', async () => {
    findFile.mockResolvedValue({ eventId: OTHER_EVENT, name: 'rider.pdf' })
    findArtist.mockResolvedValue({ eventId: EVENT, name: 'Static Bloom' })

    const out = await assignFileToArtist(EVENT, 'file_1', 'art_1')

    expect(out.kind).toBe('stop')
    expect(attachToArtist).not.toHaveBeenCalled()
  })

  it('refuses an act that is not on this event', async () => {
    findFile.mockResolvedValue({ eventId: EVENT, name: 'rider.pdf' })
    findArtist.mockResolvedValue({ eventId: OTHER_EVENT, name: 'Static Bloom' })

    const out = await assignFileToArtist(EVENT, 'file_1', 'art_1')

    expect(out.kind).toBe('stop')
    expect(attachToArtist).not.toHaveBeenCalled()
  })

  it('passes on the reason files-data refuses for, e.g. a file already on an act', async () => {
    findFile.mockResolvedValue({ eventId: EVENT, name: 'rider.pdf' })
    findArtist.mockResolvedValue({ eventId: EVENT, name: 'Static Bloom' })
    attachToArtist.mockResolvedValue({ ok: false, why: 'That file is already on an act.' })

    const out = await assignFileToArtist(EVENT, 'file_1', 'art_1')

    expect(out.kind).toBe('stop')
    expect(out.text).toBe('That file is already on an act.')
  })
})
