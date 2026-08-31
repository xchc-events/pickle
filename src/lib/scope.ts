import type { Prisma } from '@/generated/prisma/client'

/**
 * How far a user can see.
 *
 * Kept free of `server-only` so it can be tested directly — the scoping rule
 * is the one piece of the permission system that is easy to get quietly
 * wrong, and a filter applied in the view instead of the query would still
 * look right on screen.
 */
export interface ScopedUser {
  external: boolean
  /** The promoter org an external user belongs to. */
  promoter: string | null
}

/**
 * An external promoter sees only events their org brought. Everyone inside
 * the venue sees the lot.
 *
 * An external user with no org matches nothing. Returning `{}` there would
 * hand them every event in the building.
 */
export function eventScope(user: ScopedUser): Prisma.EventWhereInput {
  if (!user.external) return {}
  if (!user.promoter) return { id: { in: [] } }
  return { promoter: { contains: user.promoter } }
}
