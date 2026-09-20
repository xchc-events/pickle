import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canChangeEventRecord } from '@/lib/event-record'
import type { SessionUser } from '@/lib/session'

/**
 * The event record's actions, called by somebody outside the venue.
 *
 * `canChangeEventRecord` is tested as a rule in event-record.test.ts. This is
 * about whether every action actually asks it. Each export of actions.ts is a
 * POST endpoint whether or not a button points at it, so hiding the controls
 * from a promoter closes nothing — and an action that forgot the check would
 * look exactly like one that remembered, right up until somebody called it.
 *
 * So the actions are not listed by hand. Every function the module exports is
 * called the way a browser would call it, and anything that reads or writes
 * stops the test the moment it is reached. A new action that skips the check
 * fails here without anybody having to remember to add it.
 */

/** Everything an action reached that reads or writes. A refused call reaches none. */
const reached: string[] = []

/** A stand-in that notes it was reached, then stops the action where it is. */
const stop = (what: string) => (): never => {
  reached.push(what)
  throw new Error(`reached ${what}`)
}

const requireModule = vi.fn()
const requireEvent = vi.fn()

vi.mock('@/lib/permissions', () => ({
  requireModule: (...args: unknown[]) => requireModule(...args),
  requireEvent: (...args: unknown[]) => requireEvent(...args),
}))

vi.mock('@/lib/db', () => ({
  db: new Proxy({}, { get: (_, table) => stop(`db.${String(table)}`)() }),
}))
vi.mock('@/lib/activity', () => ({ record: stop('record') }))
vi.mock('next/cache', () => ({ refresh: stop('refresh') }))
vi.mock('@/lib/event-record-data', () => ({ loadEventRecord: stop('loadEventRecord') }))
vi.mock('@/lib/holds-data', () => ({
  placeHold: stop('placeHold'),
  confirmHold: stop('confirmHold'),
  releaseHold: stop('releaseHold'),
  challengeHold: stop('challengeHold'),
}))

const actions = (await import('./actions')) as unknown as Record<
  string,
  (...args: unknown[]) => Promise<unknown>
>
const names = Object.keys(actions).filter((name) => typeof actions[name] === 'function')

/** Slow Fold, which Kōura Records brought — squarely inside Awhina's scope. */
const EVENT = 'evt_slow_fold'

/**
 * What a browser would send after the event id. An action not listed is
 * called with the event id alone; the check comes before any argument is
 * read, so it is refused all the same.
 */
const ARGS: Record<string, unknown[]> = {
  advanceBooking: ['negotiating'],
  putToBed: [],
  setLead: ['TICKETING', 'person_mere'],
  setOwner: ['person_mere'],
  setLicence: ['confirmed'],
  setRunTime: ['barClose', '2:00am'],
  setDeal: ['AGREED', ''],
  setDateTbc: [false],
  countDoor: [{ tickets: 180, ticketRev: 4500 }],
  holdTheRoom: [],
  takeTheNight: ['hold_theirs'],
  dropTheHold: ['hold_theirs'],
  challengeTheHold: ['hold_theirs'],
}

const call = (name: string) => actions[name]!(EVENT, ...(ARGS[name] ?? []))

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

const refusal = canChangeEventRecord(awhina)
const REFUSED = { kind: 'stop', text: refusal.ok ? '' : refusal.why }

beforeEach(() => {
  reached.length = 0
  requireModule.mockReset()
  requireEvent.mockReset()
})

describe('the actions under test', () => {
  /**
   * The list below is not what is checked — every export is. It is here so
   * that moving an action into another file, where nothing would check it,
   * fails loudly instead of quietly shrinking what this covers.
   */
  it('includes every action the event record page can reach', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'advanceBooking',
        'putToBed',
        'setLead',
        'setOwner',
        'setLicence',
        'setRunTime',
        'setDeal',
        'setDateTbc',
        'countDoor',
        // `closeBar` is not here because it is not here: closing the bar moved
        // to the Bar module, under the Bar permission. Its refusal of outside
        // accounts moved with it and is checked the same way, every export, in
        // src/app/(app)/bar/actions.test.ts.
        'holdTheRoom',
        'takeTheNight',
        'dropTheHold',
        'challengeTheHold',
      ]),
    )
  })
})

describe('an external promoter, on an event their organisation brought', () => {
  beforeEach(() => {
    requireModule.mockResolvedValue({ user: awhina, modules: ['pipeline', 'portal'] })
    requireEvent.mockResolvedValue(EVENT)
  })

  it.each(names)('%s refuses them before anything is read or written', async (name) => {
    await expect(call(name)).resolves.toEqual(REFUSED)
    expect(reached).toEqual([])
  })
})

describe('a promoter whose role no longer carries Pipeline', () => {
  const NOT_FOUND = new Error('NEXT_HTTP_ERROR_FALLBACK;404')

  // The module check still comes first. Explaining the refusal to somebody
  // without the module would tell them the module exists, which the 404 in
  // requireModule is there to keep to itself.
  it.each(names)('%s still 404s rather than explaining itself', async (name) => {
    requireModule.mockRejectedValue(NOT_FOUND)

    await expect(call(name)).rejects.toBe(NOT_FOUND)
    expect(requireModule).toHaveBeenCalledWith('pipeline')
    expect(reached).toEqual([])
  })
})

describe('somebody inside the venue', () => {
  const LOOKED_UP = new Error('reached the event lookup')

  // The other half of the promoter's refusal: a check that refused everybody
  // would pass that too. A coordinator gets past it to the scoped event lookup.
  it.each(names)('%s lets them through to the event lookup', async (name) => {
    requireModule.mockResolvedValue({ user: mere, modules: ['pipeline'] })
    requireEvent.mockRejectedValue(LOOKED_UP)

    await expect(call(name)).rejects.toBe(LOOKED_UP)
    expect(requireEvent).toHaveBeenCalledWith(mere, EVENT)
  })
})
