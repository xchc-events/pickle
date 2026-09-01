/**
 * Constants ported from the design prototype's script block
 * (docs/design-handoff/design/Pickle Prototype.dc.html, near line 2866).
 *
 * These are specification, like src/lib/finance.ts: the stage names, the
 * nicknames and the default permission sets are the product's own vocabulary.
 * Changing one changes what the venue calls things.
 */

/** The eight stages an event moves through, enquiry to payout. */
export const STAGES = [
  'Enquiry',
  'Negotiating',
  'Confirmed',
  'Design',
  'On sale',
  'Rostering',
  'Show week',
  'Payout',
] as const

/** The internal nicknames for each stage. Used on the event record. */
export const NICK = [
  'Fresh',
  'Brining',
  'Sealed',
  'Labelling',
  'On the Shelf',
  'Crewing',
  'Cracked',
  'Tasting Notes',
] as const

/**
 * How many days an event should spend in each stage before someone looks at
 * it. 99 means "no target" — an event sits in On sale and Show week for as
 * long as the calendar says.
 *
 * In the prototype this array is declared but never read: the seed carries a
 * hand-written `risk` string instead. The rule it encodes is real, though —
 * `daysInStage > STAGE_TARGET[stage]` picks out exactly the seed events that
 * carry a risk note, and Home describes the at-risk count as "past their
 * stage target". See `isPastStageTarget` in src/lib/pipeline.ts.
 */
export const STAGE_TARGET = [3, 7, 4, 5, 99, 4, 99, 7] as const

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
export const BUILT_MODULES: readonly ModuleKey[] = ['pipeline', 'design', 'promo']

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

/** Capacity by room. Cabaret seating drops the main room to capSeated. */
export const SPACES = {
  MAIN: 'Main',
  APT: 'Apartment U1',
  BOTH: 'Main + Apartment U1',
} as const
