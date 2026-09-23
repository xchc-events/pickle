import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

vi.mock('server-only', () => ({}))

/**
 * Putting a design lead on an event, and taking one off.
 *
 * The Design page wires the same LeadPicker to `setDesignLead`, so "Unassigned"
 * reaches it as an empty string too. The event record's `setLead` refused that
 * as "not on the books" and could never take a lead off; this action has
 * always read any empty personId as nobody. These tests hold it to that, so
 * the two lead actions cannot drift apart again. set-lead.test.ts is the
 * other half.
 */

const requireModule = vi.fn()
const requireEvent = vi.fn()

vi.mock('@/lib/permissions', () => ({
  requireModule: (...args: unknown[]) => requireModule(...args),
  requireEvent: (...args: unknown[]) => requireEvent(...args),
}))

/** Who is on the books. Ori has left, so Admin marked him inactive. */
const PEOPLE = [
  { id: 'person_tui', name: 'Tui Ware', active: true },
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

// A server-only neighbour of setDesignLead in actions.ts. It is not reached.
vi.mock('@/lib/files-data', () => ({ begin: vi.fn(), finish: vi.fn(), linkTo: vi.fn() }))

const { setDesignLead } = await import('./actions')

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

const CLEARED = {
  kind: 'warn',
  text: 'Design has no lead. The stage gate will hold the event here.',
}

beforeEach(() => {
  vi.clearAllMocks()
  requireModule.mockResolvedValue({ user: coordinator, modules: ['pipeline', 'design'] })
  requireEvent.mockResolvedValue(EVENT)
})

describe('setDesignLead', () => {
  describe('taking the lead off', () => {
    it("clears the lead when sent '', which is what the Unassigned option sends", async () => {
      await expect(setDesignLead(EVENT, '')).resolves.toEqual(CLEARED)

      expect(deleteMany).toHaveBeenCalledWith({ where: { eventId: EVENT, role: 'DESIGN' } })
      expect(record).toHaveBeenCalledWith(EVENT, coordinator, 'Design lead cleared')
      expect(refresh).toHaveBeenCalled()
      expect(upsert).not.toHaveBeenCalled()
    })

    // The signature says string, but a POST endpoint takes what it is sent.
    it('clears the lead when sent null', async () => {
      const nobody = null as unknown as string

      await expect(setDesignLead(EVENT, nobody)).resolves.toEqual(CLEARED)

      expect(deleteMany).toHaveBeenCalledWith({ where: { eventId: EVENT, role: 'DESIGN' } })
      expect(upsert).not.toHaveBeenCalled()
    })

    it('clears the lead when sent no person at all, rather than handing it to whoever is found first', async () => {
      const noPerson = undefined as unknown as string

      await expect(setDesignLead(EVENT, noPerson)).resolves.toEqual(CLEARED)

      expect(upsert).not.toHaveBeenCalled()
    })
  })

  describe('putting somebody on', () => {
    it('makes an active person the lead', async () => {
      await expect(setDesignLead(EVENT, 'person_tui')).resolves.toEqual({
        kind: 'good',
        text: 'Tui Ware leads design on this event — every chase in that stage goes to them.',
      })

      expect(upsert).toHaveBeenCalledWith({
        where: { eventId_role: { eventId: EVENT, role: 'DESIGN' } },
        create: { eventId: EVENT, role: 'DESIGN', personId: 'person_tui' },
        update: { personId: 'person_tui' },
      })
      expect(record).toHaveBeenCalledWith(EVENT, coordinator, 'Tui Ware now leads design')
      expect(deleteMany).not.toHaveBeenCalled()
    })

    /** Refused, not read as "nobody" — clearing is the gate-failing outcome. */
    it('refuses somebody no longer on the books and leaves the lead as it was', async () => {
      await expect(setDesignLead(EVENT, 'person_ori')).resolves.toEqual({
        kind: 'stop',
        text: 'That is not somebody who works here.',
      })

      expect(upsert).not.toHaveBeenCalled()
      expect(deleteMany).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })
  })

  describe('who may', () => {
    const NOT_FOUND = new Error('NEXT_HTTP_ERROR_FALLBACK;404')

    it("clears nothing on an event outside the caller's reach", async () => {
      requireEvent.mockRejectedValue(NOT_FOUND)

      await expect(setDesignLead('evt_elsewhere', '')).rejects.toBe(NOT_FOUND)

      expect(requireModule).toHaveBeenCalledWith('design')
      expect(requireEvent).toHaveBeenCalledWith(coordinator, 'evt_elsewhere')
      expect(deleteMany).not.toHaveBeenCalled()
      expect(record).not.toHaveBeenCalled()
    })
  })
})
