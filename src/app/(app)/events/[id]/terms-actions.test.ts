import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canChangeEventRecord } from '@/lib/event-record'
import {
  actLockedBecause,
  actNameProblem,
  attendanceProblem,
  countProblem,
  feeProblem,
  figuresLine,
  lockedBecause,
  modelLockedBecause,
  modelSaid,
  splitProblem,
  splitSaid,
  statusSaid,
  type Figures,
} from '@/lib/terms'
import { capacityOf } from '@/lib/ticketing'
import type { Said } from '@/lib/toast'
import type { SessionUser } from '@/lib/session'

/**
 * The acts and terms editor's own actions: the venue's only way to change
 * `EventArtist.status/low/high/name`, `Event.split/model` and the figures the
 * projection runs off, once an event exists.
 *
 * Kept apart from actions.test.ts, same reasoning as set-owner.test.ts: that
 * file proves every export is gated, against a database that stops the
 * moment it is touched. These need one that answers, so the exact write, the
 * exact activity line and the exact toast can all be checked.
 *
 * The number-level rules (`feeProblem`, `splitProblem`, `lockedBecause` and
 * friends) live in @/lib/terms and are used here for real, never mocked —
 * the same reason `canChangeEventRecord` is real in every actions test.
 * Hardcoding a second copy of a message that already lives in terms.ts would
 * only let the two quietly drift; calling the real function is what proves
 * the wiring, not a guess at its wording.
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

/** Slow Fold's own bill. Scoping the lookup to this event is what keeps an id typed into the
 * browser from reaching another night's act — see the doc comment on the actions themselves. */
const EVENT = 'evt_slow_fold'

type ArtistLookup = { where: { id: string; eventId: string } }

/** Who is on Slow Fold's bill. Marram has already been paid; Hot Coals has not. */
const ARTISTS = [
  {
    id: 'artist_hotcoals',
    eventId: EVENT,
    name: 'Hot Coals',
    status: 'PENCILLED',
    low: 400,
    high: 700,
    payeeId: null,
    paid: false,
    order: 0,
  },
  {
    id: 'artist_marram',
    eventId: EVENT,
    name: 'Marram',
    status: 'CONFIRMED',
    low: 300,
    high: 300,
    payeeId: null,
    paid: true,
    order: 1,
  },
]

const findFirstArtist = vi.fn(
  async ({ where }: ArtistLookup) =>
    ARTISTS.find((a) => a.id === where.id && a.eventId === where.eventId) ?? null,
)
const findManyArtist = vi.fn()
const updateArtist = vi.fn()
const createArtist = vi.fn()
const deleteArtist = vi.fn()

const findUniqueOrThrow = vi.fn()
const updateEvent = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    event: {
      findUniqueOrThrow,
      update: updateEvent,
    },
    eventArtist: {
      findFirst: findFirstArtist,
      findMany: findManyArtist,
      update: updateArtist,
      create: createArtist,
      delete: deleteArtist,
    },
  },
}))

const record = vi.fn()
const refresh = vi.fn()

vi.mock('@/lib/activity', () => ({ record: (...args: unknown[]) => record(...args) }))
vi.mock('next/cache', () => ({ refresh: (...args: unknown[]) => refresh(...args) }))

// Server-only neighbours of these actions in actions.ts. None of the eight reach them.
vi.mock('@/lib/event-record-data', () => ({ loadEventRecord: vi.fn() }))
vi.mock('@/lib/holds-data', () => ({
  placeHold: vi.fn(),
  confirmHold: vi.fn(),
  releaseHold: vi.fn(),
  challengeHold: vi.fn(),
}))

const { setActStatus, setActFees, renameAct, addAct, removeAct, setSplit, setModel, setFigures } =
  await import('./actions')

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

/** A healthy, unlocked event. Individual tests override one field at a time. */
const CURRENT_EVENT = {
  concluded: false,
  model: 'CURATOR',
  depositRaisedAt: null as Date | null,
  invoiceRaisedAt: null as Date | null,
  att: [50, 80, 110],
  barHead: 8,
  gear: 200,
  adv: 100,
  crew: 3,
  tok: 1,
  format: 'DJs',
  space: { name: 'Wine Cellar', capacity: 250, seatedCapacity: 140 },
  barBudget: null as { id: string } | null,
}

const actionFns = {
  setActStatus,
  setActFees,
  renameAct,
  addAct,
  removeAct,
  setSplit,
  setModel,
  setFigures,
} as unknown as Record<string, (...args: unknown[]) => Promise<Said>>

/** What a browser would send after the event id, for the cross-cutting checks below. */
const ARGS: Record<string, unknown[]> = {
  setActStatus: ['artist_hotcoals', 'confirmed'],
  setActFees: ['artist_hotcoals', 500, 800],
  renameAct: ['artist_hotcoals', 'The Hot Coals'],
  addAct: ['Two Tides'],
  removeAct: ['artist_hotcoals'],
  setSplit: [60],
  setModel: ['dry'],
  setFigures: [{ att: [60, 90, 120], barHead: 10, gear: 250, adv: 120, crew: 4, tok: 2 }],
}

const names = Object.keys(actionFns)
const call = (name: string) => actionFns[name]!(EVENT, ...ARGS[name]!)

/** Nothing read past the gate that refused, and nothing written. */
function expectNothingWritten() {
  expect(findFirstArtist).not.toHaveBeenCalled()
  expect(findManyArtist).not.toHaveBeenCalled()
  expect(updateEvent).not.toHaveBeenCalled()
  expect(updateArtist).not.toHaveBeenCalled()
  expect(createArtist).not.toHaveBeenCalled()
  expect(deleteArtist).not.toHaveBeenCalled()
  expect(record).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  requireModule.mockResolvedValue({ user: mere, modules: ['pipeline'] })
  requireEvent.mockResolvedValue(EVENT)
  findUniqueOrThrow.mockResolvedValue(CURRENT_EVENT)
  findManyArtist.mockResolvedValue([])
})

describe('who may', () => {
  it.each(names)(
    '%s refuses an outside promoter before anything is read or written',
    async (name) => {
      requireModule.mockResolvedValue({ user: awhina, modules: ['pipeline', 'portal'] })

      await expect(call(name)).resolves.toEqual(REFUSED)

      expect(requireEvent).not.toHaveBeenCalled()
      expect(findUniqueOrThrow).not.toHaveBeenCalled()
      expectNothingWritten()
    },
  )

  it.each(names)(
    '%s still 404s rather than explaining itself, when Pipeline is not open to them',
    async (name) => {
      const NOT_FOUND = new Error('NEXT_HTTP_ERROR_FALLBACK;404')
      requireModule.mockRejectedValue(NOT_FOUND)

      await expect(call(name)).rejects.toBe(NOT_FOUND)

      expect(requireModule).toHaveBeenCalledWith('pipeline')
      expect(requireEvent).not.toHaveBeenCalled()
      expect(findUniqueOrThrow).not.toHaveBeenCalled()
      expectNothingWritten()
    },
  )

  it.each(names)(
    '%s lets a coordinator through to the scoped event lookup before any write',
    async (name) => {
      const LOOKED_UP = new Error('reached the event lookup')
      requireEvent.mockRejectedValue(LOOKED_UP)

      await expect(call(name)).rejects.toBe(LOOKED_UP)

      expect(requireEvent).toHaveBeenCalledWith(mere, EVENT)
      expect(findUniqueOrThrow).not.toHaveBeenCalled()
      expectNothingWritten()
    },
  )
})

describe('a concluded night', () => {
  it.each(names)('%s refuses %s and writes nothing', async (name) => {
    findUniqueOrThrow.mockResolvedValue({ ...CURRENT_EVENT, concluded: true })

    await expect(call(name)).resolves.toEqual({
      kind: 'stop',
      text: lockedBecause({ concluded: true }),
    })

    expectNothingWritten()
  })
})

describe('setActStatus', () => {
  it('marks an act confirmed', async () => {
    await expect(setActStatus(EVENT, 'artist_hotcoals', 'confirmed')).resolves.toEqual(
      statusSaid('Hot Coals', 'confirmed'),
    )

    expect(updateArtist).toHaveBeenCalledWith({
      where: { id: 'artist_hotcoals' },
      data: { status: 'CONFIRMED' },
    })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'marked Hot Coals confirmed')
    expect(refresh).toHaveBeenCalled()
  })

  it('marks an act declined, with the surplus warning from statusSaid', async () => {
    await expect(setActStatus(EVENT, 'artist_hotcoals', 'declined')).resolves.toEqual(
      statusSaid('Hot Coals', 'declined'),
    )

    expect(updateArtist).toHaveBeenCalledWith({
      where: { id: 'artist_hotcoals' },
      data: { status: 'DECLINED' },
    })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'marked Hot Coals declined')
  })

  it('refuses a status an act cannot have', async () => {
    await expect(setActStatus(EVENT, 'artist_hotcoals', 'headlining')).resolves.toEqual({
      kind: 'stop',
      text: 'That is not a status an act can have.',
    })

    expect(updateArtist).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses to move a paid act, with the actLockedBecause text', async () => {
    await expect(setActStatus(EVENT, 'artist_marram', 'declined')).resolves.toEqual({
      kind: 'stop',
      text: actLockedBecause({ name: 'Marram', paid: true }),
    })

    expect(updateArtist).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses an act id that is not on this bill, scoped to the event', async () => {
    await expect(setActStatus(EVENT, 'artist_elsewhere', 'confirmed')).resolves.toEqual({
      kind: 'stop',
      text: 'That act is not on this bill.',
    })

    expect(findFirstArtist).toHaveBeenCalledWith({
      where: { id: 'artist_elsewhere', eventId: EVENT },
    })
    expect(updateArtist).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })
})

describe('setActFees', () => {
  it("sets an act's fee floor and ceiling", async () => {
    await expect(setActFees(EVENT, 'artist_hotcoals', 500, 800)).resolves.toEqual({
      kind: 'good',
      text: 'Hot Coals is $500–$800 — the floor and ceiling moved with it.',
    })

    expect(updateArtist).toHaveBeenCalledWith({
      where: { id: 'artist_hotcoals' },
      data: { low: 500, high: 800 },
    })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'set Hot Coals’s fee range to $500–$800')
    expect(refresh).toHaveBeenCalled()
  })

  it('refuses a negative fee', async () => {
    await expect(setActFees(EVENT, 'artist_hotcoals', -10, 50)).resolves.toEqual({
      kind: 'warn',
      text: feeProblem(-10, 50),
    })

    expect(updateArtist).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses a ceiling under the floor', async () => {
    await expect(setActFees(EVENT, 'artist_hotcoals', 500, 300)).resolves.toEqual({
      kind: 'warn',
      text: feeProblem(500, 300),
    })

    expect(updateArtist).not.toHaveBeenCalled()
  })

  it('refuses a fee over $100,000', async () => {
    await expect(setActFees(EVENT, 'artist_hotcoals', 0, 150_000)).resolves.toEqual({
      kind: 'warn',
      text: feeProblem(0, 150_000),
    })

    expect(updateArtist).not.toHaveBeenCalled()
  })

  it('refuses to change a paid act’s fees, with the actLockedBecause text', async () => {
    await expect(setActFees(EVENT, 'artist_marram', 100, 200)).resolves.toEqual({
      kind: 'stop',
      text: actLockedBecause({ name: 'Marram', paid: true }),
    })

    expect(updateArtist).not.toHaveBeenCalled()
  })

  it('refuses an act id that is not on this bill, scoped to the event', async () => {
    await expect(setActFees(EVENT, 'artist_elsewhere', 100, 200)).resolves.toEqual({
      kind: 'stop',
      text: 'That act is not on this bill.',
    })

    expect(findFirstArtist).toHaveBeenCalledWith({
      where: { id: 'artist_elsewhere', eventId: EVENT },
    })
    expect(updateArtist).not.toHaveBeenCalled()
  })
})

describe('renameAct', () => {
  it('renames an act', async () => {
    await expect(renameAct(EVENT, 'artist_hotcoals', 'The Hot Coals')).resolves.toEqual({
      kind: 'good',
      text: 'Renamed Hot Coals to The Hot Coals. Listings, the contract and the door list all read this field.',
    })

    expect(updateArtist).toHaveBeenCalledWith({
      where: { id: 'artist_hotcoals' },
      data: { name: 'The Hot Coals' },
    })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'renamed Hot Coals to The Hot Coals')
    expect(refresh).toHaveBeenCalled()
  })

  it('renames a paid act too — only the fee line is frozen, not the name', async () => {
    await expect(renameAct(EVENT, 'artist_marram', 'Marram Collective')).resolves.toEqual({
      kind: 'good',
      text: 'Renamed Marram to Marram Collective. Listings, the contract and the door list all read this field.',
    })

    expect(updateArtist).toHaveBeenCalledWith({
      where: { id: 'artist_marram' },
      data: { name: 'Marram Collective' },
    })
  })

  it('says nothing changed when the name is the same after tidying, and writes nothing', async () => {
    await expect(renameAct(EVENT, 'artist_hotcoals', '  Hot   Coals  ')).resolves.toEqual({
      kind: 'warn',
      text: 'Nothing changed.',
    })

    expect(updateArtist).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses a blank name', async () => {
    await expect(renameAct(EVENT, 'artist_hotcoals', '   ')).resolves.toEqual({
      kind: 'warn',
      text: actNameProblem(''),
    })

    expect(updateArtist).not.toHaveBeenCalled()
  })

  it('refuses an act id that is not on this bill, scoped to the event', async () => {
    await expect(renameAct(EVENT, 'artist_elsewhere', 'Whoever')).resolves.toEqual({
      kind: 'stop',
      text: 'That act is not on this bill.',
    })

    expect(findFirstArtist).toHaveBeenCalledWith({
      where: { id: 'artist_elsewhere', eventId: EVENT },
    })
    expect(updateArtist).not.toHaveBeenCalled()
  })
})

describe('addAct', () => {
  it('adds the first act on the bill at order 0', async () => {
    findManyArtist.mockResolvedValue([])

    await expect(addAct(EVENT, 'Two Tides')).resolves.toEqual({
      kind: 'good',
      text: 'Added Two Tides to the bill — set their fee range and the floor and ceiling move with it.',
    })

    expect(createArtist).toHaveBeenCalledWith({
      data: { eventId: EVENT, name: 'Two Tides', status: 'ENQUIRED', low: 0, high: 0, order: 0 },
    })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'added Two Tides to the bill')
    expect(refresh).toHaveBeenCalled()
  })

  it('adds a later act one past the current highest order', async () => {
    findManyArtist.mockResolvedValue([{ order: 0 }, { order: 2 }])

    await expect(addAct(EVENT, 'Two Tides')).resolves.toEqual({
      kind: 'good',
      text: 'Added Two Tides to the bill — set their fee range and the floor and ceiling move with it.',
    })

    expect(createArtist).toHaveBeenCalledWith({
      data: { eventId: EVENT, name: 'Two Tides', status: 'ENQUIRED', low: 0, high: 0, order: 3 },
    })
  })

  it('tidies the name before adding it', async () => {
    findManyArtist.mockResolvedValue([])

    await addAct(EVENT, '  Two   Tides  ')

    expect(createArtist).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Two Tides' }) }),
    )
  })

  it('refuses a thirteenth act', async () => {
    findManyArtist.mockResolvedValue(Array.from({ length: 12 }, (_, order) => ({ order })))

    await expect(addAct(EVENT, 'Two Tides')).resolves.toEqual({
      kind: 'warn',
      text: 'Twelve acts is the most one booking takes.',
    })

    expect(createArtist).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses a blank name without reading how many acts are already on the bill', async () => {
    await expect(addAct(EVENT, '   ')).resolves.toEqual({
      kind: 'warn',
      text: actNameProblem(''),
    })

    expect(findManyArtist).not.toHaveBeenCalled()
    expect(createArtist).not.toHaveBeenCalled()
  })
})

describe('removeAct', () => {
  it('takes an act off the bill', async () => {
    await expect(removeAct(EVENT, 'artist_hotcoals')).resolves.toEqual({
      kind: 'warn',
      text: 'Hot Coals removed from the bill.',
    })

    expect(deleteArtist).toHaveBeenCalledWith({ where: { id: 'artist_hotcoals' } })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'took Hot Coals off the bill')
    expect(refresh).toHaveBeenCalled()
  })

  it('refuses to remove a paid act, with the actLockedBecause text', async () => {
    await expect(removeAct(EVENT, 'artist_marram')).resolves.toEqual({
      kind: 'stop',
      text: actLockedBecause({ name: 'Marram', paid: true }),
    })

    expect(deleteArtist).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses an act id that is not on this bill, scoped to the event', async () => {
    await expect(removeAct(EVENT, 'artist_elsewhere')).resolves.toEqual({
      kind: 'stop',
      text: 'That act is not on this bill.',
    })

    expect(findFirstArtist).toHaveBeenCalledWith({
      where: { id: 'artist_elsewhere', eventId: EVENT },
    })
    expect(deleteArtist).not.toHaveBeenCalled()
  })
})

describe('setSplit', () => {
  it('sets the split, stored as a fraction of 1', async () => {
    await expect(setSplit(EVENT, 60)).resolves.toEqual(splitSaid(60))

    expect(updateEvent).toHaveBeenCalledWith({ where: { id: EVENT }, data: { split: 0.6 } })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'set the split to 60% to their people')
    expect(refresh).toHaveBeenCalled()
  })

  it('sets the split back to nothing agreed, with the warning from splitSaid', async () => {
    await expect(setSplit(EVENT, 0)).resolves.toEqual(splitSaid(0))

    expect(updateEvent).toHaveBeenCalledWith({ where: { id: EVENT }, data: { split: 0 } })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'set the split to 0% to their people')
  })

  it('refuses a split over 100', async () => {
    await expect(setSplit(EVENT, 101)).resolves.toEqual({ kind: 'warn', text: splitProblem(101) })

    expect(updateEvent).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  // The action-table spec asks for a whole-number check here too ("else the
  // split message"), but the finalised splitProblem only checks
  // finite/0–100 — no integer check. Reusing its message for a case it does
  // not cover would mean hard-coding a second copy of that text, which is
  // exactly what owning the rule in terms.ts is meant to prevent. Flagged in
  // the PR description as a gap for a decision against terms.ts, not
  // silently patched over here.
  it('accepts a split that is not a whole number, since splitProblem does not check for one', async () => {
    await expect(setSplit(EVENT, 62.5)).resolves.toEqual(splitSaid(62.5))

    expect(updateEvent).toHaveBeenCalledWith({ where: { id: EVENT }, data: { split: 0.625 } })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'set the split to 62.5% to their people')
  })
})

describe('setModel', () => {
  it('switches the booking to dry hire', async () => {
    await expect(setModel(EVENT, 'dry')).resolves.toEqual(modelSaid('dry'))

    expect(updateEvent).toHaveBeenCalledWith({ where: { id: EVENT }, data: { model: 'DRY' } })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'set the booking to dry hire')
    expect(refresh).toHaveBeenCalled()
  })

  it('switches the booking to the curator model', async () => {
    findUniqueOrThrow.mockResolvedValue({ ...CURRENT_EVENT, model: 'DRY' })

    await expect(setModel(EVENT, 'curator')).resolves.toEqual(modelSaid('curator'))

    expect(updateEvent).toHaveBeenCalledWith({ where: { id: EVENT }, data: { model: 'CURATOR' } })
    expect(record).toHaveBeenCalledWith(EVENT, mere, 'set the booking to curator model')
  })

  it('refuses a model that does not exist', async () => {
    await expect(setModel(EVENT, 'freebie')).resolves.toEqual({
      kind: 'stop',
      text: 'That is not a booking model.',
    })

    expect(updateEvent).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('says nothing changed when the model is already what was asked for', async () => {
    await expect(setModel(EVENT, 'curator')).resolves.toEqual({
      kind: 'warn',
      text: 'Nothing changed.',
    })

    expect(updateEvent).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses once the deposit has been raised', async () => {
    const ev = { ...CURRENT_EVENT, depositRaisedAt: new Date('2026-09-01') }
    findUniqueOrThrow.mockResolvedValue(ev)

    await expect(setModel(EVENT, 'dry')).resolves.toEqual({
      kind: 'stop',
      text: modelLockedBecause(ev),
    })

    expect(updateEvent).not.toHaveBeenCalled()
  })

  it('refuses once the settlement invoice has been raised', async () => {
    const ev = { ...CURRENT_EVENT, invoiceRaisedAt: new Date('2026-09-01') }
    findUniqueOrThrow.mockResolvedValue(ev)

    await expect(setModel(EVENT, 'dry')).resolves.toEqual({
      kind: 'stop',
      text: modelLockedBecause(ev),
    })

    expect(updateEvent).not.toHaveBeenCalled()
  })
})

describe('setFigures', () => {
  const NEW: Figures = { att: [60, 90, 120], barHead: 10, gear: 250, adv: 120, crew: 4, tok: 2 }
  const BEFORE: Figures = { att: [50, 80, 110], barHead: 8, gear: 200, adv: 100, crew: 3, tok: 1 }

  it('saves the figures and names everything that changed', async () => {
    const line = figuresLine(BEFORE, NEW)

    await expect(setFigures(EVENT, NEW)).resolves.toEqual({
      kind: 'good',
      text: 'Figures saved — the projection and the settlement read them now.',
    })

    expect(updateEvent).toHaveBeenCalledWith({
      where: { id: EVENT },
      data: NEW,
    })
    expect(record).toHaveBeenCalledWith(EVENT, mere, line)
    expect(refresh).toHaveBeenCalled()
  })

  it('appends the bar-budget sentence only when a barBudget row exists', async () => {
    findUniqueOrThrow.mockResolvedValue({ ...CURRENT_EVENT, barBudget: { id: 'bb_1' } })

    await expect(setFigures(EVENT, NEW)).resolves.toEqual({
      kind: 'good',
      text:
        'Figures saved — the projection and the settlement read them now.' +
        ' The bar budget stays as it was locked.',
    })
  })

  it('names only what changed, when only one figure moves', async () => {
    const partial: Figures = { ...BEFORE, crew: 5 }
    const line = figuresLine(BEFORE, partial)

    await setFigures(EVENT, partial)

    expect(record).toHaveBeenCalledWith(EVENT, mere, line)
  })

  it('says nothing changed when every figure is what it already was, and writes nothing', async () => {
    await expect(setFigures(EVENT, BEFORE)).resolves.toEqual({
      kind: 'warn',
      text: 'Nothing changed.',
    })

    expect(updateEvent).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses attendance out of order', async () => {
    const bad: Figures = { ...NEW, att: [120, 80, 50] }
    const room = {
      name: 'Wine Cellar',
      holds: capacityOf(CURRENT_EVENT.space, 'DJs'),
      seated: false,
    }

    await expect(setFigures(EVENT, bad)).resolves.toEqual({
      kind: 'warn',
      text: attendanceProblem(bad.att, room),
    })

    expect(updateEvent).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses a great-night figure over the room’s capacity, with the seated wording for Cabaret', async () => {
    const cabaret = { ...CURRENT_EVENT, format: 'Cabaret' }
    findUniqueOrThrow.mockResolvedValue(cabaret)
    const holds = capacityOf(cabaret.space, 'Cabaret')
    const bad: Figures = { ...NEW, att: [50, 80, holds + 50] }
    const room = { name: 'Wine Cellar', holds, seated: true }

    await expect(setFigures(EVENT, bad)).resolves.toEqual({
      kind: 'warn',
      text: attendanceProblem(bad.att, room),
    })

    expect(updateEvent).not.toHaveBeenCalled()
  })

  it('refuses a fractional crew', async () => {
    const bad: Figures = { ...NEW, crew: 3.5 }
    const holds = capacityOf(CURRENT_EVENT.space, 'DJs')

    await expect(setFigures(EVENT, bad)).resolves.toEqual({
      kind: 'warn',
      text: countProblem(3.5, holds),
    })

    expect(updateEvent).not.toHaveBeenCalled()
  })
})

// The form sends numbers and names. The endpoint behind it takes whatever a
// signed-in person cares to POST, so what is not a figure or a name at all is
// refused in words rather than left to throw somewhere inside a rule.
describe('a request written by hand', () => {
  const NEW: Figures = { att: [60, 90, 120], barHead: 10, gear: 250, adv: 120, crew: 4, tok: 2 }

  it('is refused when what it sends is not a set of figures, and nothing is written', async () => {
    const notFigures = { att: [60, 90], barHead: '10' } as unknown as Figures

    await expect(setFigures(EVENT, notFigures)).resolves.toEqual({
      kind: 'stop',
      text: 'Those are not figures.',
    })
    expect(updateEvent).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  // The enquiry form has always stopped at a hundred crew and twenty tokens a
  // head. The room's capacity is no ceiling for either: tokens are per head.
  it('cannot put more crew on a night than the enquiry form would take', async () => {
    await expect(setFigures(EVENT, { ...NEW, crew: 101 })).resolves.toEqual({
      kind: 'warn',
      text: countProblem(101, 100),
    })
    expect(updateEvent).not.toHaveBeenCalled()
  })

  it('cannot hand out more tokens a head than the enquiry form would take', async () => {
    await expect(setFigures(EVENT, { ...NEW, tok: 21 })).resolves.toEqual({
      kind: 'warn',
      text: countProblem(21, 20),
    })
    expect(updateEvent).not.toHaveBeenCalled()
  })

  it('reads a name that is not text as no name at all', async () => {
    const notText = 42 as unknown as string

    await expect(addAct(EVENT, notText)).resolves.toEqual({
      kind: 'warn',
      text: 'Give the act a name.',
    })
    await expect(renameAct(EVENT, 'artist_hotcoals', notText)).resolves.toEqual({
      kind: 'warn',
      text: 'Give the act a name.',
    })
    expect(updateArtist).not.toHaveBeenCalled()
  })
})
