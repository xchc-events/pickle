import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which events can be chased in a promoter's portal.
 *
 * This replaces four copies of an in-memory substring match on
 * `User.promoter` — one each in event-record-data, pipeline-data,
 * design-data and home-data, each of whose comments claimed to be identical
 * to the others while in fact applying a different rule. The substring match
 * is the same shape `scope.ts` documents removing from access control: an
 * organisation called "Sound" matched "Puha Sound" and "Wheke Sound" alike.
 *
 * It also stopped working. Nothing has written `User.promoter` since the
 * promoter-organisations migration — `addUser` and `setOrganisation` both
 * write `organisationId` alone — so every account made since is invisible to
 * a rule that filters on it, and `hasPortal` silently reads false. That is
 * not cosmetic: `needsPromoterSignOff` in design.ts hangs off it, so hero and
 * lead artwork quietly stopped requiring the promoter's sign-off.
 */

vi.mock('server-only', () => ({}))

const userFindMany = vi.fn()
vi.mock('./db', () => ({ db: { user: { findMany: (...a: unknown[]) => userFindMany(...a) } } }))

const { hasPortalFor, organisationsWithPortal, portalCoordinatorsByOrganisation } =
  await import('./portal-access')

const KOURA = 'payee_koura_records'
const HEX = 'payee_hex_collective'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('hasPortalFor', () => {
  const orgs = new Set([KOURA])

  it('an event whose organisation has a live account can be chased in a portal', () => {
    expect(hasPortalFor({ internal: false, promoterId: KOURA }, orgs)).toBe(true)
  })

  it('an organisation with no account of its own cannot', () => {
    expect(hasPortalFor({ internal: false, promoterId: HEX }, orgs)).toBe(false)
  })

  it('an event with no organisation on it cannot — there is nobody to chase', () => {
    expect(hasPortalFor({ internal: false, promoterId: null }, orgs)).toBe(false)
  })

  it('an in-house event never can, whatever it carries', () => {
    expect(hasPortalFor({ internal: true, promoterId: KOURA }, orgs)).toBe(false)
  })

  /**
   * The regression the substring match caused, and the reason this is keyed
   * on an id. "Sound" is a substring of "Puha Sound", so an account for one
   * used to answer for the other.
   */
  it('one organisation does not answer for another whose name contains it', () => {
    const sound = 'payee_sound'
    const puhaSound = 'payee_puha_sound'
    expect(hasPortalFor({ internal: false, promoterId: puhaSound }, new Set([sound]))).toBe(false)
  })
})

describe('organisationsWithPortal', () => {
  it('asks only for live external accounts that carry an organisation', async () => {
    userFindMany.mockResolvedValue([])

    await organisationsWithPortal()

    expect(userFindMany).toHaveBeenCalledTimes(1)
    const { where, select } = userFindMany.mock.calls[0][0]
    expect(where).toEqual({
      role: 'PROMOTER',
      active: true,
      organisationId: { not: null },
    })
    // The id, and nothing else — this never loads a person or an address.
    expect(select).toEqual({ organisationId: true })
  })

  it('returns the organisation ids, collapsing the several accounts one org may have', async () => {
    userFindMany.mockResolvedValue([
      { organisationId: KOURA },
      { organisationId: KOURA },
      { organisationId: HEX },
    ])

    const orgs = await organisationsWithPortal()

    expect(orgs).toEqual(new Set([KOURA, HEX]))
  })

  it('is empty when no outside account is set up, rather than throwing', async () => {
    userFindMany.mockResolvedValue([])

    expect(await organisationsWithPortal()).toEqual(new Set())
  })
})

/**
 * The Pipeline shows the outside coordinator's avatar on the row. It used to
 * find them by the same substring match, so a row could show a coordinator
 * from an organisation that merely shared a word with its promoter's name.
 */
describe('portalCoordinatorsByOrganisation', () => {
  it('keys each coordinator by the organisation they act for', async () => {
    userFindMany.mockResolvedValue([
      {
        organisationId: KOURA,
        name: 'Awhina Reid',
        email: 'awhina@koura.example',
        person: { name: 'Awhina Reid', initials: 'AR' },
      },
    ])

    const found = await portalCoordinatorsByOrganisation()

    expect(found.get(KOURA)).toEqual({ name: 'Awhina Reid', initials: 'AR' })
  })

  it('falls back to the account when no person is linked, as the row always did', async () => {
    userFindMany.mockResolvedValue([
      { organisationId: HEX, name: 'Devon Marsh', email: 'devon@hex.example', person: null },
    ])

    expect((await portalCoordinatorsByOrganisation()).get(HEX)).toEqual({
      name: 'Devon Marsh',
      initials: 'DM',
    })
  })

  it('initials an account with no name at all off its address', async () => {
    userFindMany.mockResolvedValue([
      { organisationId: HEX, name: null, email: 'devon@hex.example', person: null },
    ])

    expect((await portalCoordinatorsByOrganisation()).get(HEX)?.initials).toBeTruthy()
  })

  /** Several accounts may share one organisation — the first is the row's. */
  it('keeps one coordinator per organisation', async () => {
    userFindMany.mockResolvedValue([
      { organisationId: KOURA, name: 'Awhina Reid', email: 'a@k.example', person: null },
      { organisationId: KOURA, name: 'Second Account', email: 's@k.example', person: null },
    ])

    const found = await portalCoordinatorsByOrganisation()

    expect(found.size).toBe(1)
    expect(found.get(KOURA)?.name).toBe('Awhina Reid')
  })

  it('answers hasPortalFor directly, so the Pipeline needs only the one query', async () => {
    userFindMany.mockResolvedValue([
      { organisationId: KOURA, name: 'Awhina Reid', email: 'a@k.example', person: null },
    ])

    const found = await portalCoordinatorsByOrganisation()

    expect(hasPortalFor({ internal: false, promoterId: KOURA }, found)).toBe(true)
    expect(hasPortalFor({ internal: false, promoterId: HEX }, found)).toBe(false)
  })
})
