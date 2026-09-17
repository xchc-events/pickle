import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERMS, VENUE_ONLY, type ModuleKey } from './constants'
import type { SessionUser } from './session'

/**
 * Server-side access control, against a permission table kept in memory.
 *
 * The bug: an outside promoter whose role had been granted Home or Bar saw
 * both in the sidebar, and both 404ed — each page refuses an outside account,
 * but `modulesFor` handed over the rows as they were. Granted Admin, nothing
 * refused them at all. The venue's own modules are now dropped where the list
 * is read, so the sidebar and `requireModule` can no longer disagree.
 */

vi.mock('server-only', () => ({}))

/** ModulePermission, as rows. */
let rows: { role: string; module: string }[] = []

const db = {
  modulePermission: {
    findMany: vi.fn(async (args?: { where?: { role?: string } }) =>
      rows
        .filter((r) => !args?.where?.role || r.role === args.where.role)
        .map((r) => ({ module: r.module })),
    ),
  },
  event: { findFirst: vi.fn() },
}
vi.mock('./db', () => ({ db }))

const session = { currentUser: vi.fn() }
vi.mock('./session', () => session)

class NotFoundSignal extends Error {
  constructor() {
    super('NEXT_HTTP_ERROR_FALLBACK;404')
  }
}
class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`)
  }
}
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFoundSignal()
  },
  redirect: (url: string) => {
    throw new RedirectSignal(url)
  },
}))

const { canSee, modulesFor, requireEvent, requireModule, requireUser } =
  await import('./permissions')

const awhina: SessionUser = {
  id: 'kr',
  email: 'kr@xchc.test',
  name: 'Awhina Reid',
  role: 'PROMOTER',
  roleKey: 'promoter',
  organisationId: 'org_koura',
  organisationName: 'Kōura Records',
  external: true,
  personId: null,
  initials: 'AR',
  authenticated: true,
  sessionId: 'session_kr',
}

const sione: SessionUser = {
  id: 'sl',
  email: 'sl@xchc.test',
  name: 'Sione Latu',
  role: 'ADMIN',
  roleKey: 'admin',
  organisationId: null,
  organisationName: null,
  external: false,
  personId: 'person_sl',
  initials: 'SL',
  authenticated: true,
  sessionId: 'session_sl',
}

/** A grant somebody made to the outside role. */
const grantPromoter = (...modules: ModuleKey[]) =>
  rows.push(...modules.map((module) => ({ role: 'PROMOTER', module })))

beforeEach(() => {
  rows = Object.entries(DEFAULT_PERMS).flatMap(([role, mods]) =>
    mods.map((module) => ({ role: role.toUpperCase(), module })),
  )
  session.currentUser.mockReset()
  db.event.findFirst.mockReset()
})

describe('modulesFor', () => {
  it('gives venue staff every module their role is granted', async () => {
    expect(await modulesFor(sione)).toEqual(DEFAULT_PERMS.admin)
  })

  it('gives an outside account the modules its role is granted', async () => {
    expect(await modulesFor(awhina)).toEqual(['pipeline', 'portal'])
  })

  it('never gives an outside account Home, Bar or Admin, even when its role is granted them', async () => {
    grantPromoter('home', 'bar', 'admin')
    expect(await modulesFor(awhina)).toEqual(['pipeline', 'portal'])
  })
})

describe('canSee', () => {
  it('says no to an outside account about a venue module its role was granted', async () => {
    grantPromoter('bar')
    expect(await canSee(awhina, 'bar')).toBe(false)
    expect(await canSee(awhina, 'pipeline')).toBe(true)
  })

  it('says yes to venue staff about a module their role is granted', async () => {
    expect(await canSee(sione, 'bar')).toBe(true)
  })
})

describe('requireModule', () => {
  it('sends somebody who is not signed in to sign in', async () => {
    session.currentUser.mockResolvedValue(null)
    await expect(requireModule('pipeline')).rejects.toEqual(new RedirectSignal('/sign-in'))
  })

  it('404s a module the role is not granted', async () => {
    session.currentUser.mockResolvedValue(awhina)
    await expect(requireModule('finance')).rejects.toBeInstanceOf(NotFoundSignal)
  })

  it.each([...VENUE_ONLY])(
    '404s an outside account on %s even when its role is granted it',
    async (key) => {
      grantPromoter(key)
      session.currentUser.mockResolvedValue(awhina)
      await expect(requireModule(key)).rejects.toBeInstanceOf(NotFoundSignal)
    },
  )

  it('lets an outside account into its own modules, with none of the venue’s in the list', async () => {
    grantPromoter('home', 'bar', 'admin')
    session.currentUser.mockResolvedValue(awhina)
    const { user, modules } = await requireModule('pipeline')
    expect(user).toBe(awhina)
    // Pages draw links off this list, the event record's way into the bar among them.
    expect(modules).toEqual(['pipeline', 'portal'])
  })

  it.each([...VENUE_ONLY])('still lets venue staff into %s', async (key) => {
    session.currentUser.mockResolvedValue(sione)
    const { user, modules } = await requireModule(key)
    expect(user).toBe(sione)
    expect(modules).toContain(key)
  })
})

describe('requireUser', () => {
  it('sends somebody who is not signed in to sign in', async () => {
    session.currentUser.mockResolvedValue(null)
    await expect(requireUser()).rejects.toEqual(new RedirectSignal('/sign-in'))
  })

  it('lets any signed-in account through, whatever its modules', async () => {
    session.currentUser.mockResolvedValue(awhina)
    await expect(requireUser()).resolves.toBe(awhina)
  })
})

describe('requireEvent', () => {
  it('looks the event up inside the user’s scope', async () => {
    db.event.findFirst.mockResolvedValue({ id: 'ev_kiwa' })
    await expect(requireEvent(awhina, 'ev_kiwa')).resolves.toBe('ev_kiwa')
    expect(db.event.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ id: 'ev_kiwa' }, { promoterId: 'org_koura' }] },
      select: { id: true },
    })
  })

  it('404s an event outside the user’s scope', async () => {
    db.event.findFirst.mockResolvedValue(null)
    await expect(requireEvent(awhina, 'ev_hex')).rejects.toBeInstanceOf(NotFoundSignal)
  })
})
