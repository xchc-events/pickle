import type { Prisma } from '@/generated/prisma/client'

/**
 * How far a user can see.
 *
 * Kept free of `server-only` so the scoping rule can be tested directly — it
 * is the one piece of the permission system that is easy to get quietly
 * wrong, and a filter applied in the view instead of the query would still
 * look right on screen.
 *
 * ## Why this is an id and not a name
 *
 * This used to read `{ promoter: { contains: user.promoter } }` — an
 * unanchored substring match against `Event.promoter`, a free-text field typed
 * by venue staff. An organisation called "Sound" therefore matched every event
 * whose promoter field contained that word: "Puha Sound", "Wheke Sound". Their
 * portal, their pipeline, their ticket figures and their settlement terms all
 * came back for an organisation that had nothing to do with them.
 *
 * The name stays on `Event.promoter` because it is what the pipeline shows and
 * what staff type. What it no longer does is decide who may read the row.
 */
export interface ScopedUser {
  external: boolean
  /** The organisation an external user belongs to — a `Payee` id. */
  organisationId: string | null
}

/**
 * An external promoter sees only events their organisation brought. Everyone
 * inside the venue sees the lot.
 *
 * An external user with no organisation matches nothing. Returning `{}` there
 * would hand them every event in the building, which is why it has its own
 * test rather than relying on a caller to check first.
 */
export function eventScope(user: ScopedUser): Prisma.EventWhereInput {
  if (!user.external) return {}
  if (!user.organisationId) return { id: { in: [] } }
  return { promoterId: user.organisationId }
}
