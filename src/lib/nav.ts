import { BUILT_MODULES, MODULES, type ModuleKey } from './constants'

/**
 * The module nav, as a list.
 *
 * Drawn twice — as the sidebar on a wide screen, and in the menu sheet on a
 * narrow one — and both draw this, built from the role's ModulePermission
 * rows. It is a convenience, not the control: a module left off it is refused
 * by URL too. See src/lib/permissions.ts.
 */

export interface NavItem {
  key: ModuleKey
  label: string
  /** Phosphor icon name, regular weight. */
  icon: string
  /** Null for a module the role can see but that is not built yet. */
  href: string | null
}

export function navItems(
  modules: readonly ModuleKey[],
  user: { external: boolean },
  built: readonly ModuleKey[] = BUILT_MODULES,
): NavItem[] {
  return MODULES.filter((m) => modules.includes(m.key)).map((m) => ({
    key: m.key,
    label: m.key === 'pipeline' && user.external ? 'Your events' : m.label,
    icon: m.icon,
    href: built.includes(m.key) ? `/${m.key}` : null,
  }))
}
