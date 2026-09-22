import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canChangeEventRecord } from '@/lib/event-record'
import type { SessionUser } from '@/lib/session'

/**
 * Naming an event's external coordinator, and clearing it.
 *
 * `promoterId` is not a display field — it is the only thing `eventScope`
 * (src/lib/scope.ts) matches on to let an outside account see an event at
 * all, so changing it is a permission change, not only a naming one.
 * Modelled on set-owner.test.ts: the same refusal, the same shape.
 *
 * Kept apart from actions.test.ts, which calls every action as an outside
 * promoter against a database that stops the moment it is touched. This
 * needs one that answers, and two organisations to move an event between.
 */

// actions.ts now imports @/lib/grants-data (for issueArtistLink, moved here
// from Tech 23 Sep 2026), which imports 'server-only'. The real package
// throws outside a server-component build, so every test file that imports
// actions.ts for real needs this — see artist-link-actions.test.ts.
vi.mock('server-only', () => ({}))

const requireModule = vi.fn()
const requireEvent = vi.fn()

vi.mock('@/lib/permissions', () => ({
  requireModule: (...args: unknown[]) => requireModule(...args),
  requireEvent: (...args: unknown[]) => requireEvent(...args),
}))

/** Two promoter organisations on file, and one payee that is not one. */
const PAYEES = [
  { id: 'payee_koura', name: 'Kōura Records', kind: 'PROMOTER' },
  { id: 'payee_wheke', name: 'Wheke Sound', kind: 'PROMOTER' },
  { id: 'payee_ohbaby', name: 'Oh Baby', kind: 'ARTIST' },
]

const matches = <T>(value: T, filter: T | undefined) => filter === undefined || value === filter

type PayeeQuery = { where: { id?: string; kind?: string } }

const findFirst = vi.fn(async ({ where }: PayeeQuery) => {
  const hit = PAYEES.find((p) => matches(p.id, where.id) && matches(p.kind, where.kind))
  return hit ? { id: hit.id, name: hit.name } : null
})

const update = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    payee: { findFirst: (query: PayeeQuery) => findFirst(query) },
    event: { update: (...args: unknown[]) => update(...args) },
  },
}))

const record = vi.fn()
const refresh = vi.fn()

vi.mock('@/lib/activity', () => ({ record: (...args: unknown[]) => record(...args) }))
vi.mock('next/cache', () => ({ refresh: (...args: unknown[]) => refresh(...args) }))

// Server-only neighbours of setPromoterOrg in actions.ts. It reaches none of
// them.
vi.mock('@/lib/event-record-data', () => ({ loadEventRecord: vi.fn() }))
vi.mock('@/lib/holds-data', () => ({
  placeHold: vi.fn(),
  confirmHold: vi.fn(),
  releaseHold: vi.fn(),
  challengeHold: vi.fn(),
}))

const { setPromoterOrg } = await import('./actions')

/** Slow Fold, which Kōura Records brought — same fixture as set-owner.test.ts. */
const EVENT = 'evt_slow_fold'

const coordinator = {
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

const awhina = {
  id: 'user_awhina',
  email: 'awhina@koura.test',
  name: 'Awhina Reid',
  role: 'PROMOTER',
  roleKey: 'promoter',
  organisationId: 'org_koura',
  organisationName: 'Kōura Records',
  external: true,
  personId: null,
  initials: 'AR',
  authenticated: true,
  sessionId: 'session_awhina',
} satisfies SessionUser

const refusal = canChangeEventRecord(awhina)
const REFUSED = { kind: 'stop', text: refusal.ok ? '' : refusal.why }

beforeEach(() => {
  vi.clearAllMocks()
  requireModule.mockResolvedValue({ user: coordinator, modules: ['pipeline'] })
  requireEvent.mockResolvedValue(EVENT)
})

describe('setPromoterOrg', () => {
  describe('naming an external coordinator', () => {
    it('names an organisation on file', async () => {
      await expect(setPromoterOrg(EVENT, 'payee_koura')).resolves.toEqual({
        kind: 'good',
        text: 'Kōura Records can now see this event.',
      })

      expect(findFirst).toHaveBeenCalledWith({
        where: { id: 'payee_koura', kind: 'PROMOTER' },
        select: { id: true, name: true },
      })
      expect(update).toHaveBeenCalledWith({
        where: { id: EVENT },
        data: { promoterId: 'payee_koura', promoter: 'Kōura Records' },
      })
      expect(record).toHaveBeenCalledWith(
        EVENT,
        coordinator,
        'made Kōura Records the external coordinator',
      )
      expect(refresh).toHaveBeenCalled()
    })

    /** The whole reason this write matters: it moves who may read the event. */
    it("moves the event out of one organisation's scope and into another's", async () => {
      await setPromoterOrg(EVENT, 'payee_koura')
      expect(update).toHaveBeenNthCalledWith(1, {
        where: { id: EVENT },
        data: { promoterId: 'payee_koura', promoter: 'Kōura Records' },
      })

      await setPromoterOrg(EVENT, 'payee_wheke')
      expect(update).toHaveBeenNthCalledWith(2, {
        where: { id: EVENT },
        data: { promoterId: 'payee_wheke', promoter: 'Wheke Sound' },
      })
    })

    it('refuses a payee on file that is not a promoter organisation', async () => {
      await expect(setPromoterOrg(EVENT, 'payee_ohbaby')).resolves.toEqual({
        kind: 'stop',
        text: 'That organisation is not on file.',
      })

      expect(update).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })

    it("refuses an id that isn't on file at all", async () => {
      await expect(setPromoterOrg(EVENT, 'payee_ghost')).resolves.toEqual({
        kind: 'stop',
        text: 'That organisation is not on file.',
      })

      expect(update).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })
  })

  describe('clearing it', () => {
    it("clears it when sent '', which is what the picker's none option sends", async () => {
      await expect(setPromoterOrg(EVENT, '')).resolves.toEqual({
        kind: 'warn',
        text: 'No external coordinator now — only the venue can see this one.',
      })

      expect(findFirst).not.toHaveBeenCalled()
      expect(update).toHaveBeenCalledWith({
        where: { id: EVENT },
        data: { promoterId: null, promoter: null },
      })
      expect(record).toHaveBeenCalledWith(
        EVENT,
        coordinator,
        'left this event without an external coordinator',
      )
      expect(refresh).toHaveBeenCalled()
    })

    it('clears it when sent null', async () => {
      await expect(setPromoterOrg(EVENT, null)).resolves.toEqual({
        kind: 'warn',
        text: 'No external coordinator now — only the venue can see this one.',
      })

      expect(update).toHaveBeenCalledWith({
        where: { id: EVENT },
        data: { promoterId: null, promoter: null },
      })
    })
  })

  describe('who may', () => {
    const NOT_FOUND = new Error('NEXT_HTTP_ERROR_FALLBACK;404')

    it('refuses an outside promoter before anything is read or written', async () => {
      requireModule.mockResolvedValue({ user: awhina, modules: ['pipeline', 'portal'] })

      await expect(setPromoterOrg(EVENT, 'payee_koura')).resolves.toEqual(REFUSED)

      expect(requireEvent).not.toHaveBeenCalled()
      expect(findFirst).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })

    it('404s rather than explaining itself, when Pipeline is not open to them', async () => {
      requireModule.mockRejectedValue(NOT_FOUND)

      await expect(setPromoterOrg(EVENT, 'payee_koura')).rejects.toBe(NOT_FOUND)

      expect(requireModule).toHaveBeenCalledWith('pipeline')
      expect(requireEvent).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
    })

    it("refuses on an event outside the caller's reach", async () => {
      requireEvent.mockRejectedValue(NOT_FOUND)

      await expect(setPromoterOrg('evt_elsewhere', '')).rejects.toBe(NOT_FOUND)

      expect(requireModule).toHaveBeenCalledWith('pipeline')
      expect(requireEvent).toHaveBeenCalledWith(coordinator, 'evt_elsewhere')
      expect(update).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })
  })
})
