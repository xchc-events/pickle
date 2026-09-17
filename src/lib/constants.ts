/**
 * Constants ported from the design prototype's script block
 * (docs/design-handoff/design/Pickle Prototype.dc.html, near line 2866).
 *
 * These are specification, like src/lib/finance.ts: the module names and the
 * default permission sets are the product's own vocabulary. Changing one
 * changes what the venue calls things.
 *
 * The eight stage names, their nicknames and their day targets used to live
 * here too. Since 16 September 2026 an event carries a status per part rather
 * than sitting at one stage; the booking kept the first three stages' names,
 * nicknames and targets, and the parts the rest — all in src/lib/parts.ts.
 */

export type ModuleKey =
  | 'home'
  | 'pipeline'
  | 'ticketing'
  | 'design'
  | 'promo'
  | 'tech'
  | 'roster'
  | 'bar'
  | 'hours'
  | 'finance'
  | 'admin'
  | 'portal'

export interface ModuleDef {
  key: ModuleKey
  label: string
  /** Phosphor icon name, regular weight. */
  icon: string
}

export const MODULES: readonly ModuleDef[] = [
  { key: 'home', label: 'Home', icon: 'ph-house' },
  { key: 'pipeline', label: 'Pipeline', icon: 'ph-flask' },
  { key: 'ticketing', label: 'Ticketing', icon: 'ph-ticket' },
  { key: 'design', label: 'Design', icon: 'ph-tag' },
  { key: 'promo', label: 'Promotion', icon: 'ph-megaphone' },
  { key: 'tech', label: 'Tech production', icon: 'ph-sliders' },
  { key: 'roster', label: 'Roster', icon: 'ph-users-three' },
  { key: 'bar', label: 'Bar', icon: 'ph-beer-bottle' },
  { key: 'hours', label: 'Hours', icon: 'ph-clock' },
  { key: 'finance', label: 'Finance', icon: 'ph-receipt' },
  { key: 'admin', label: 'Admin', icon: 'ph-sliders-horizontal' },
  { key: 'portal', label: 'Sign-offs', icon: 'ph-seal-check' },
]

/** Which modules are actually built. The rest are in the nav but inert. */
export const BUILT_MODULES: readonly ModuleKey[] = [
  'pipeline',
  'design',
  'promo',
  'tech',
  'portal',
  'finance',
  'roster',
  'admin',
  'hours',
  'ticketing',
  'bar',
]

export type RoleKey = 'coordinator' | 'design' | 'tech' | 'bar' | 'admin' | 'promoter'

export const ROLE_LABEL: Record<RoleKey, string> = {
  coordinator: 'Event coordinator',
  design: 'Design & comms',
  tech: 'Technical production',
  bar: 'Bar & duty manager',
  admin: 'Super admin',
  promoter: 'External coordinator · outside the venue',
}

/**
 * Role → modules. Seeded into ModulePermission; Admin mutates the rows, not
 * this map. A module absent here is absent from the sidebar *and* unreachable
 * by URL — the check is server-side, see src/lib/permissions.ts.
 */
export const DEFAULT_PERMS: Record<RoleKey, ModuleKey[]> = {
  coordinator: [
    'home',
    'pipeline',
    'ticketing',
    'design',
    'promo',
    'tech',
    'roster',
    'bar',
    'hours',
    'finance',
  ],
  design: ['home', 'pipeline', 'ticketing', 'design', 'promo', 'hours'],
  tech: ['home', 'pipeline', 'tech', 'roster', 'hours'],
  bar: ['home', 'roster', 'bar', 'hours'],
  admin: [
    'home',
    'pipeline',
    'ticketing',
    'design',
    'promo',
    'tech',
    'roster',
    'bar',
    'hours',
    'finance',
    'admin',
  ],
  promoter: ['pipeline', 'portal'],
}

/**
 * The venue's own modules. An outside account never opens these, whatever its
 * role's rows say: Home is the venue's own to-do list, Bar its own trading,
 * Admin every account it has. Everything else scopes an outside account to its
 * own organisation's events, so it can be granted without showing them more.
 *
 * Granting is per role, and a grant knows nothing about who is outside, so
 * this is applied where the rows are read — see `modulesOpenTo` in
 * src/lib/scope.ts. Decided 17 September 2026, after a promoter granted Home
 * and Bar was shown sidebar links that could only 404.
 */
export const VENUE_ONLY: readonly ModuleKey[] = ['home', 'bar', 'admin']
