import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canChangeEventRecord } from '@/lib/event-record'
import type { SessionUser } from '@/lib/session'

/**
 * Naming an event's owner, and clearing it.
 *
 * Nothing before this could set `Event.ownerId` — an enquiry an outside
 * promoter sends in arrives with nobody's name on it, and it had no way to
 * ever clear the "An owner is named" booking gate. `setOwner` is that one
 * place, modelled on `setLead` right above it in actions.ts.
 *
 * LeadPicker's "Unassigned" is `<option value="">`, so clearing the owner
 * from the event record reaches `setOwner` as an empty string, never as
 * null. Both are covered here, the same way set-lead.test.ts covers `setLead`.
 *
 * Kept apart from actions.test.ts, which calls every action as an outside
 * promoter against a database that stops the moment it is touched. These
 * need one that answers, and one that can tell an internal night from one an
 * outside organisation brought.
 */

const requireModule = vi.fn()
const requireEvent = vi.fn()

vi.mock('@/lib/permissions', () => ({
  requireModule: (...args: unknown[]) => requireModule(...args),
  requireEvent: (...args: unknown[]) => requireEvent(...args),
}))

/** Who is on the books. Ori has left, so Admin marked him inactive. */
const PEOPLE = [
  { id: 'person_jonty', name: 'Jonty Rewi', active: true },
  { id: 'person_ori', name: 'Ori Beckett', active: false },
]

/**
 * Prisma leaves out a filter whose value is undefined — `strictUndefinedChecks`
 * is a preview feature this schema does not turn on — so `{ id: undefined,
 * active: true }` means any active person. The stand-in does the same, or it
 * would hide the worst way this can go wrong.
 */
const matches = <T>(value: T, filter: T | undefined) => filter === undefined || value === filter

type PersonQuery = { where: { id?: string; active?: boolean } }

const findFirst = vi.fn(async ({ where }: PersonQuery) => {
  const hit = PEOPLE.find((p) => matches(p.id, where.id) && matches(p.active, where.active))
  return hit ? { id: hit.id, name: hit.name } : null
})

/** Whether the event under test is one of ours. Reset to external each test. */
let internal = false

const findUniqueOrThrow = vi.fn(async () => ({ internal }))
const update = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    person: { findFirst: (query: PersonQuery) => findFirst(query) },
    event: {
      findUniqueOrThrow,
      update: (...args: unknown[]) => update(...args),
    },
  },
}))

const record = vi.fn()
const refresh = vi.fn()

vi.mock('@/lib/activity', () => ({ record: (...args: unknown[]) => record(...args) }))
vi.mock('next/cache', () => ({ refresh: (...args: unknown[]) => refresh(...args) }))

// Server-only neighbours of setOwner in actions.ts. It reaches none of them.
vi.mock('@/lib/event-record-data', () => ({ loadEventRecord: vi.fn() }))
vi.mock('@/lib/holds-data', () => ({
  placeHold: vi.fn(),
  confirmHold: vi.fn(),
  releaseHold: vi.fn(),
  challengeHold: vi.fn(),
}))

const { setOwner } = await import('./actions')

/**
 * Slow Fold, which Kōura Records brought — external, same as actions.test.ts.
 * `internal` defaults to false below, so every test that doesn't flip it is
 * also proof the booking contact is never touched on a night like this one.
 */
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

const OWNED = {
  kind: 'good',
  text: 'Jonty Rewi owns this one now — its gates come to them.',
}

const CLEARED = {
  kind: 'warn',
  text: 'Nobody owns this one now — it goes back to the unclaimed queue on Home.',
}

beforeEach(() => {
  vi.clearAllMocks()
  internal = false
  requireModule.mockResolvedValue({ user: coordinator, modules: ['pipeline'] })
  requireEvent.mockResolvedValue(EVENT)
})

describe('setOwner', () => {
  describe('naming an owner', () => {
    it('makes an active person the owner', async () => {
      await expect(setOwner(EVENT, 'person_jonty')).resolves.toEqual(OWNED)

      expect(findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: EVENT },
        select: { internal: true },
      })
      expect(update).toHaveBeenCalledWith({
        where: { id: EVENT },
        data: { ownerId: 'person_jonty' },
      })
      expect(record).toHaveBeenCalledWith(EVENT, coordinator, 'made Jonty Rewi the owner')
      expect(refresh).toHaveBeenCalled()
    })

    /** Refused, not read as "nobody" — clearing is the gate-failing outcome. */
    it('refuses somebody no longer on the books and leaves the owner as it was', async () => {
      await expect(setOwner(EVENT, 'person_ori')).resolves.toEqual({
        kind: 'stop',
        text: 'That person is not on the books.',
      })

      expect(findFirst).toHaveBeenCalledWith({
        where: { id: 'person_ori', active: true },
        select: { id: true, name: true },
      })
      expect(update).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })

    it("refuses a person id that isn't on the books at all", async () => {
      await expect(setOwner(EVENT, 'person_ghost')).resolves.toEqual({
        kind: 'stop',
        text: 'That person is not on the books.',
      })

      expect(update).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })
  })

  describe('clearing the owner', () => {
    it("clears the owner when sent '', which is what the picker's empty option sends", async () => {
      await expect(setOwner(EVENT, '')).resolves.toEqual(CLEARED)

      expect(update).toHaveBeenCalledWith({
        where: { id: EVENT },
        data: { ownerId: null },
      })
      expect(record).toHaveBeenCalledWith(EVENT, coordinator, 'left this event without an owner')
      expect(refresh).toHaveBeenCalled()
    })

    it('clears the owner when sent null', async () => {
      await expect(setOwner(EVENT, null)).resolves.toEqual(CLEARED)

      expect(update).toHaveBeenCalledWith({
        where: { id: EVENT },
        data: { ownerId: null },
      })
    })
  })

  describe('keeping the booking contact in step, on an internal event', () => {
    beforeEach(() => {
      internal = true
    })

    it('names the booking contact after the new owner', async () => {
      await expect(setOwner(EVENT, 'person_jonty')).resolves.toEqual(OWNED)

      expect(update).toHaveBeenCalledWith({
        where: { id: EVENT },
        data: { ownerId: 'person_jonty', promoter: 'internal · Jonty Rewi' },
      })
    })

    it('drops the booking contact back to unassigned when the owner is cleared', async () => {
      await expect(setOwner(EVENT, '')).resolves.toEqual(CLEARED)

      expect(update).toHaveBeenCalledWith({
        where: { id: EVENT },
        data: { ownerId: null, promoter: 'internal · unassigned' },
      })
    })
  })

  describe('who may', () => {
    const NOT_FOUND = new Error('NEXT_HTTP_ERROR_FALLBACK;404')

    it('refuses an outside promoter before anything is read or written', async () => {
      requireModule.mockResolvedValue({ user: awhina, modules: ['pipeline', 'portal'] })

      await expect(setOwner(EVENT, 'person_jonty')).resolves.toEqual(REFUSED)

      expect(requireEvent).not.toHaveBeenCalled()
      expect(findUniqueOrThrow).not.toHaveBeenCalled()
      expect(findFirst).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })

    it('404s rather than explaining itself, when Pipeline is not open to them', async () => {
      requireModule.mockRejectedValue(NOT_FOUND)

      await expect(setOwner(EVENT, 'person_jonty')).rejects.toBe(NOT_FOUND)

      expect(requireModule).toHaveBeenCalledWith('pipeline')
      expect(requireEvent).not.toHaveBeenCalled()
      expect(findUniqueOrThrow).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })

    // '' now reaches an update where it used to reach nothing at all, so the
    // scope check in front of it matters more than it did.
    it("names nobody on an event outside the caller's reach", async () => {
      requireEvent.mockRejectedValue(NOT_FOUND)

      await expect(setOwner('evt_elsewhere', '')).rejects.toBe(NOT_FOUND)

      expect(requireModule).toHaveBeenCalledWith('pipeline')
      expect(requireEvent).toHaveBeenCalledWith(coordinator, 'evt_elsewhere')
      expect(findUniqueOrThrow).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })
  })
})
