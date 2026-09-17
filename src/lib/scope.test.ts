import { describe, expect, it } from 'vitest'
import type { Role } from '@/generated/prisma/client'
import { DEFAULT_PERMS, MODULES, VENUE_ONLY, type ModuleKey, type RoleKey } from './constants'
import { modulesOpenByRole, modulesOpenTo } from './scope'

/**
 * Which modules an outside account can open.
 *
 * Granting is per role, and a grant knows nothing about whether the role is
 * inside the venue. On 17 September 2026 an outside promoter whose role had
 * been granted Home and Bar was shown both in the sidebar, and both 404ed: each
 * page refuses an outside account whatever the rows say, but the rows went
 * straight to the sidebar. Admin had no refusal at all, so the same grant
 * would have opened every account in the building to them.
 */

const EVERY: ModuleKey[] = MODULES.map((m) => m.key)

/** The rows the seed writes: DEFAULT_PERMS, one row per role and module. */
const seeded = Object.entries(DEFAULT_PERMS).flatMap(([role, mods]) =>
  mods.map((module) => ({ role: role.toUpperCase() as Role, module: module as string })),
)

describe('VENUE_ONLY', () => {
  it('is Home, Bar and Admin', () => {
    // Home is the venue's own to-do list, Bar its own trading, Admin every
    // account it has. Taking one off is a decision, not a tidy-up.
    expect([...VENUE_ONLY].sort()).toEqual(['admin', 'bar', 'home'])
  })

  it('is never granted to the outside role by default', () => {
    expect(DEFAULT_PERMS.promoter.filter((m) => VENUE_ONLY.includes(m))).toEqual([])
  })
})

describe('modulesOpenTo', () => {
  it('leaves venue staff every module their role is granted', () => {
    expect(modulesOpenTo({ external: false }, EVERY)).toEqual(EVERY)
  })

  it('takes Home, Bar and Admin away from an outside account, whatever it is granted', () => {
    // Everything left scopes an outside account to its own organisation's
    // events, so granting any of it shows them their own shows and nothing
    // more.
    expect(modulesOpenTo({ external: true }, EVERY)).toEqual([
      'pipeline',
      'ticketing',
      'design',
      'promo',
      'tech',
      'roster',
      'hours',
      'finance',
      'portal',
    ])
  })

  it('leaves an outside account its default modules untouched', () => {
    expect(modulesOpenTo({ external: true }, DEFAULT_PERMS.promoter)).toEqual([
      'pipeline',
      'portal',
    ])
  })
})

describe('modulesOpenByRole', () => {
  it('leaves every venue role exactly what it is granted', () => {
    const byRole = modulesOpenByRole(seeded)
    for (const key of ['coordinator', 'design', 'tech', 'bar', 'admin'] as RoleKey[]) {
      expect(byRole.get(key.toUpperCase() as Role)).toEqual(DEFAULT_PERMS[key])
    }
  })

  it('leaves the outside role only what an outside account can open', () => {
    const granted = [
      ...seeded,
      { role: 'PROMOTER' as Role, module: 'home' },
      { role: 'PROMOTER' as Role, module: 'bar' },
      { role: 'PROMOTER' as Role, module: 'admin' },
      { role: 'PROMOTER' as Role, module: 'finance' },
    ]
    expect(modulesOpenByRole(granted).get('PROMOTER')).toEqual(['pipeline', 'portal', 'finance'])
  })

  it('has nothing for a role with no rows', () => {
    const noTech = seeded.filter((r) => r.role !== 'TECH')
    expect(modulesOpenByRole(noTech).get('TECH')).toBeUndefined()
  })
})
