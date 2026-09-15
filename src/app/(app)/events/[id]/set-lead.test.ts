import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

/**
 * Putting a department lead on an event, and taking one off.
 *
 * LeadPicker's "Unassigned" is `<option value="">`, so taking a lead off from
 * the event record reaches `setLead` as an empty string, never as null. The
 * action only cleared on null: the empty string went looking for a person
 * whose id is '', found nobody, and was refused as "not on the books". A lead
 * could be put on from the page and never taken off again.
 *
 * The action is a POST endpoint, so what counts as nobody is settled there,
 * not left to whichever control happens to call it. set-design-lead.test.ts
 * holds Design's own lead action to the same contract.
 *
 * Kept apart from actions.test.ts, which calls every action as an outside
 * promoter against a database that stops the moment it is touched. These
 * need one that answers.
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
const deleteMany = vi.fn()
const upsert = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    person: { findFirst: (query: PersonQuery) => findFirst(query) },
    eventLead: {
      deleteMany: (...args: unknown[]) => deleteMany(...args),
      upsert: (...args: unknown[]) => upsert(...args),
    },
  },
}))

const record = vi.fn()
const refresh = vi.fn()

vi.mock('@/lib/activity', () => ({ record: (...args: unknown[]) => record(...args) }))
vi.mock('next/cache', () => ({ refresh: (...args: unknown[]) => refresh(...args) }))

// Server-only neighbours of setLead in actions.ts. It reaches none of them.
vi.mock('@/lib/event-record-data', () => ({ loadEventRecord: vi.fn() }))
vi.mock('@/lib/bar-data', () => ({ budgetToLock: vi.fn() }))
vi.mock('@/lib/holds-data', () => ({
  placeHold: vi.fn(),
  confirmHold: vi.fn(),
  releaseHold: vi.fn(),
  challengeHold: vi.fn(),
}))

const { setLead } = await import('./actions')

const EVENT = 'evt_slow_fold'

const coordinator = {
  id: 'user_mere',
  name: 'Mere Tapu',
  role: 'COORDINATOR',
  roleKey: 'coordinator',
  organisationId: null,
  organisationName: null,
  external: false,
  personId: 'person_mere',
  initials: 'MT',
  authenticated: true,
} satisfies SessionUser

const CLEARED = {
  kind: 'warn',
  text: 'Nobody owns ticketing now — the stage gate will hold on it.',
}

beforeEach(() => {
  vi.clearAllMocks()
  requireModule.mockResolvedValue({ user: coordinator, modules: ['pipeline'] })
  requireEvent.mockResolvedValue(EVENT)
})

describe('setLead', () => {
  describe('taking a lead off', () => {
    /** The reported bug: this was refused as "That person is not on the books." */
    it("clears the lead when sent '', which is what the Unassigned option sends", async () => {
      await expect(setLead(EVENT, 'TICKETING', '')).resolves.toEqual(CLEARED)

      expect(deleteMany).toHaveBeenCalledWith({ where: { eventId: EVENT, role: 'TICKETING' } })
      expect(record).toHaveBeenCalledWith(EVENT, coordinator, 'left ticketing without a lead')
      expect(refresh).toHaveBeenCalled()
      expect(upsert).not.toHaveBeenCalled()
    })

    it('clears the lead when sent null', async () => {
      await expect(setLead(EVENT, 'TICKETING', null)).resolves.toEqual(CLEARED)

      expect(deleteMany).toHaveBeenCalledWith({ where: { eventId: EVENT, role: 'TICKETING' } })
      expect(upsert).not.toHaveBeenCalled()
    })

    /**
     * Nothing on the page sends this, but anybody can POST it. Looked up, it
     * is "any active person", and whoever the database returned first would
     * have been told they own the department.
     */
    it('clears the lead when sent no person at all, rather than handing it to whoever is found first', async () => {
      const noPerson = undefined as unknown as string | null

      await expect(setLead(EVENT, 'TICKETING', noPerson)).resolves.toEqual(CLEARED)

      expect(upsert).not.toHaveBeenCalled()
    })
  })

  describe('putting somebody on', () => {
    it('makes an active person the lead', async () => {
      await expect(setLead(EVENT, 'TECH', 'person_jonty')).resolves.toEqual({
        kind: 'good',
        text: 'Jonty Rewi owns tech on this one.',
      })

      expect(upsert).toHaveBeenCalledWith({
        where: { eventId_role: { eventId: EVENT, role: 'TECH' } },
        create: { eventId: EVENT, role: 'TECH', personId: 'person_jonty' },
        update: { personId: 'person_jonty' },
      })
      expect(record).toHaveBeenCalledWith(EVENT, coordinator, 'put Jonty Rewi on tech')
      expect(deleteMany).not.toHaveBeenCalled()
    })

    /** Refused, not read as "nobody" — clearing is the gate-failing outcome. */
    it('refuses somebody no longer on the books and leaves the lead as it was', async () => {
      await expect(setLead(EVENT, 'TECH', 'person_ori')).resolves.toEqual({
        kind: 'stop',
        text: 'That person is not on the books.',
      })

      expect(upsert).not.toHaveBeenCalled()
      expect(deleteMany).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })
  })

  describe('who may', () => {
    const NOT_FOUND = new Error('NEXT_HTTP_ERROR_FALLBACK;404')

    // '' now reaches a delete where it used to reach a refusal, so the scope
    // check in front of it matters more than it did.
    it("clears nothing on an event outside the caller's reach", async () => {
      requireEvent.mockRejectedValue(NOT_FOUND)

      await expect(setLead('evt_elsewhere', 'TICKETING', '')).rejects.toBe(NOT_FOUND)

      expect(requireModule).toHaveBeenCalledWith('pipeline')
      expect(requireEvent).toHaveBeenCalledWith(coordinator, 'evt_elsewhere')
      expect(deleteMany).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })
  })
})
