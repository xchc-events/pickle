import { describe, expect, it } from 'vitest'
import type { ModuleKey } from './constants'
import { navItems } from './nav'

/**
 * The module nav.
 *
 * It is drawn twice — as the sidebar on a wide screen, and in the menu sheet
 * on a narrow one — and both draw this one list, built from the role's
 * ModulePermission rows. It is a convenience, not the control: a module left
 * off it is refused by URL too (src/lib/permissions.ts). What these tests pin
 * is that the list says the same thing wherever it is drawn.
 */

const staff = { external: false }
const promoter = { external: true }

describe('navItems', () => {
  it("lists only the modules the role is granted, in the product's order rather than the rows'", () => {
    const keys = navItems(['hours', 'bar', 'roster'], staff).map((item) => item.key)

    expect(keys).toEqual(['roster', 'bar', 'hours'])
  })

  it('lists nothing for a role granted nothing', () => {
    expect(navItems([], staff)).toEqual([])
  })

  /**
   * Permission rows are strings in the database. A key the product has since
   * dropped must not turn into a link to a page that is not there.
   */
  it('skips a granted key the product has no module for', () => {
    const keys = navItems(['bar', 'box-office' as ModuleKey], staff).map((item) => item.key)

    expect(keys).toEqual(['bar'])
  })

  it('links a built module to its page', () => {
    expect(navItems(['bar'], staff)).toEqual([
      { key: 'bar', label: 'Bar', icon: 'ph-beer-bottle', href: '/bar' },
    ])
  })

  it('still lists a module that is not built yet, so the shape of the product shows, but links it nowhere', () => {
    const [home, bar] = navItems(['home', 'bar'], staff, ['bar'])

    expect(home).toMatchObject({ key: 'home', label: 'Home', href: null })
    expect(bar).toMatchObject({ key: 'bar', href: '/bar' })
  })

  it('calls Pipeline "Your events" for an external promoter, who only ever sees their own there', () => {
    const labels = navItems(['pipeline', 'portal'], promoter).map((item) => item.label)

    expect(labels).toEqual(['Your events', 'Sign-offs'])
  })

  it('calls it Pipeline for venue staff', () => {
    const [pipeline] = navItems(['pipeline'], staff)

    expect(pipeline.label).toBe('Pipeline')
  })
})
