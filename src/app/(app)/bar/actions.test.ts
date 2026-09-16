import { beforeEach, describe, expect, it, vi } from 'vitest'
import { barRefusal } from '@/lib/bar'
import type { SessionUser } from '@/lib/session'

/**
 * Bar's actions, called by somebody outside the venue.
 *
 * `barRefusal` is tested as a rule in bar.test.ts. This is about whether every
 * action actually asks it — the same question actions.test.ts on the event
 * record asks of `canChangeEventRecord`, and for the same reason: each export
 * is a POST endpoint whether or not a button points at it.
 *
 * Closing the bar used to live on the event record, where that test covered
 * it. It moved here with the Bar module, and a check that does not follow an
 * action to its new file leaves that action covered by nothing. So this file
 * exists to carry the guarantee across the move rather than to drop it.
 *
 * A promoter does not carry Bar by default, so `requireModule('bar')` would
 * 404 them first. That is not the control this checks. Module rows are edited
 * live in Admin, and the rule `barRefusal` states is that the bar is the
 * venue's own trading "whatever their module rows say" — so the promoter here
 * is given Bar, and has to be refused anyway.
 *
 * As on the event record, the actions are not listed by hand: every export is
 * called, and anything that reads or writes stops the test the moment it is
 * reached.
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
vi.mock('@/lib/bar-data', () => ({
  budgetToLock: stop('budgetToLock'),
  tillWindowFor: stop('tillWindowFor'),
}))
// Epos Now is the till. Reading it for another organisation's night would be
// disclosure of the venue's sales, so it is a stand-in that stops like the rest.
vi.mock('@/lib/eposnow', () => ({
  isConfigured: stop('eposnow.isConfigured'),
  readTill: stop('eposnow.readTill'),
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
  closeBarByHand: [{ barTake: 3200, barProfit: 1900 }],
  previewTill: [],
  closeBarFromTill: [],
  lockBudgetLate: [],
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

const ana = {
  id: 'user_ana',
  email: 'ana@xchc.test',
  name: 'Ana Kelliher',
  role: 'BAR',
  roleKey: 'bar',
  organisationId: null,
  organisationName: null,
  external: false,
  personId: 'person_ana',
  initials: 'AK',
  authenticated: true,
  sessionId: 'session_ana',
} satisfies SessionUser

const WHY = barRefusal(awhina)

/**
 * The refusal, in whichever shape the action returns. Most actions answer with
 * a toast; `previewTill` answers the preview panel with `{ ok, why }`. Both
 * have to carry barRefusal's words, and neither shape may be anything else.
 */
const isRefusal = (result: unknown) =>
  typeof result === 'object' &&
  result !== null &&
  (('kind' in result && result.kind === 'stop' && 'text' in result && result.text === WHY) ||
    ('ok' in result && result.ok === false && 'why' in result && result.why === WHY))

beforeEach(() => {
  reached.length = 0
  requireModule.mockReset()
  requireEvent.mockReset()
})

describe('the actions under test', () => {
  it('has a refusal to check against', () => {
    // Without this, a barRefusal that stopped refusing would make every
    // isRefusal below compare against null and fail for the wrong reason.
    expect(WHY).toMatch(/.+/)
  })

  /**
   * The list below is not what is checked — every export is. It is here so
   * that moving an action out of this file, where nothing would check it,
   * fails loudly instead of quietly shrinking what this covers.
   */
  it('includes every action the Bar page can reach', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'closeBarByHand',
        'previewTill',
        'closeBarFromTill',
        'lockBudgetLate',
      ]),
    )
  })
})

describe('an external promoter, even one given the Bar module', () => {
  beforeEach(() => {
    requireModule.mockResolvedValue({ user: awhina, modules: ['pipeline', 'portal', 'bar'] })
    requireEvent.mockResolvedValue(EVENT)
  })

  it.each(names)('%s refuses them before anything is read or written', async (name) => {
    const result = await call(name)
    expect(isRefusal(result)).toBe(true)
    expect(reached).toEqual([])
  })

  it.each(names)('%s refuses them before the event lookup', async (name) => {
    // Refused on who they are, not on which event — so the scoped lookup is
    // never needed, and never tells them anything.
    await call(name)
    expect(requireEvent).not.toHaveBeenCalled()
  })
})

describe('a promoter without the Bar module', () => {
  const NOT_FOUND = new Error('NEXT_HTTP_ERROR_FALLBACK;404')

  // The module check still comes first. Explaining the refusal to somebody
  // without the module would tell them the module exists.
  it.each(names)('%s still 404s rather than explaining itself', async (name) => {
    requireModule.mockRejectedValue(NOT_FOUND)

    await expect(call(name)).rejects.toBe(NOT_FOUND)
    expect(requireModule).toHaveBeenCalledWith('bar')
    expect(reached).toEqual([])
  })
})

describe('the bar manager', () => {
  const LOOKED_UP = new Error('reached the event lookup')

  // The other half of the refusal: a check that refused everybody would pass
  // the promoter cases too. The bar manager gets past it to the scoped lookup.
  it.each(names)('%s lets them through to the event lookup', async (name) => {
    requireModule.mockResolvedValue({ user: ana, modules: ['home', 'roster', 'bar', 'hours'] })
    requireEvent.mockRejectedValue(LOOKED_UP)

    await expect(call(name)).rejects.toBe(LOOKED_UP)
    expect(requireEvent).toHaveBeenCalledWith(ana, EVENT)
  })
})
