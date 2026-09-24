import 'server-only'
import { db } from './db'
import { initialsOf } from './format'

/**
 * Whether an event's promoter can be chased in their own portal.
 *
 * Several gates word themselves off this — "waiting on them in their portal"
 * rather than "record the agreement once they say yes", and
 * `needsPromoterSignOff` in design.ts, which is what makes hero and lead
 * artwork wait for the promoter's approval. So it decides workflow, and it
 * has to be one rule.
 *
 * ## Why this is an id, and why it is one function
 *
 * It was four. The event record, the Pipeline, Design and Home each carried
 * their own copy, each matching the organisation's *name* as a substring of
 * `Event.promoter` — the free-text field staff type. That is the same shape
 * `scope.ts` documents removing from access control, for the same reason: an
 * organisation called "Sound" matched "Puha Sound" and "Wheke Sound" alike.
 *
 * The four copies also disagreed, while each one's comment said it was
 * "kept identical" to the others. Two filtered switched-off accounts out in
 * the query, one did so in memory, and Design did not at all — so a promoter
 * whose account had been closed still counted as a live portal there. Design
 * also skipped the in-house check, so an XCHC event could be told to wait on
 * a promoter's sign-off that no promoter was ever going to give.
 *
 * And it had stopped working. Nothing has written `User.promoter` since the
 * promoter-organisations migration — `addUser` and `setOrganisation` write
 * `organisationId` alone — so every account created since is invisible to a
 * rule that filters on `promoter: { not: null }`, and the answer silently
 * became false everywhere. The seed still writes the old column, which is
 * why no test caught it. `User.promoter` is now read nowhere; the schema
 * already marks it superseded.
 *
 * The relation was there the whole time: `Event.promoterId` and
 * `User.organisationId` both point at the same `Payee`, which is exactly
 * what `eventScope` matches on to decide what a promoter may read. Asking
 * the same question the same way is what keeps a gate from claiming somebody
 * has a portal that the portal itself would refuse them.
 */

/**
 * The organisations with at least one live account behind them.
 *
 * Loaded once per screen and asked about each event, rather than queried per
 * row: the callers all render a list. Only the id is selected — this answers
 * "is there anybody", never "who".
 */
export async function organisationsWithPortal(): Promise<Set<string>> {
  const rows = await db.user.findMany({
    where: { role: 'PROMOTER', active: true, organisationId: { not: null } },
    select: { organisationId: true },
  })

  const orgs = new Set<string>()
  for (const r of rows) if (r.organisationId) orgs.add(r.organisationId)
  return orgs
}

/**
 * The outside coordinator to show on a row, by the organisation they act for.
 *
 * The Pipeline accents one avatar per event with whoever is coordinating
 * from outside the venue. That used to be found by the same substring match,
 * so a row could show a coordinator belonging to an organisation that merely
 * shared a word with its promoter's name.
 *
 * Several accounts may act for one organisation — that is the point of them —
 * so the first wins, which is what the `find` this replaces did too. Returns
 * a Map, which `hasPortalFor` accepts directly: a screen that needs the
 * coordinator has already asked the question the Set would have answered.
 */
export interface PortalCoordinator {
  name: string
  initials: string
}

export async function portalCoordinatorsByOrganisation(): Promise<Map<string, PortalCoordinator>> {
  const rows = await db.user.findMany({
    where: { role: 'PROMOTER', active: true, organisationId: { not: null } },
    select: {
      organisationId: true,
      name: true,
      email: true,
      person: { select: { name: true, initials: true } },
    },
  })

  const byOrg = new Map<string, PortalCoordinator>()
  for (const r of rows) {
    if (!r.organisationId || byOrg.has(r.organisationId)) continue
    // The account's own name first, then the person behind it — the order the
    // Pipeline row has always read them in.
    const name = r.name ?? r.person?.name ?? r.email
    byOrg.set(r.organisationId, {
      name,
      initials: r.person?.initials ?? initialsOf(r.name ?? r.email),
    })
  }
  return byOrg
}

/**
 * Anything that can say whether an organisation has a portal — the Set from
 * `organisationsWithPortal`, or the Map from
 * `portalCoordinatorsByOrganisation`, so a screen that needs the coordinator
 * makes one query rather than two.
 */
export interface PortalOrgs {
  has(organisationId: string): boolean
}

/** What the event carries. Both columns are on every screen's select. */
export interface PortalEvent {
  internal: boolean
  /** The organisation that brought the show — a `Payee` id. */
  promoterId: string | null
}

/**
 * Whether this event's promoter has a portal, against the set above.
 *
 * In-house events are excluded before the id is looked at. Their promoter
 * field names a staff member rather than an organisation, and after
 * `setPromoterOrg` they carry no `promoterId` at all — but an event marked
 * internal while still holding one should not start asking an outside
 * promoter to sign off the venue's own show.
 */
export function hasPortalFor(event: PortalEvent, orgs: PortalOrgs): boolean {
  if (event.internal) return false
  return event.promoterId !== null && orgs.has(event.promoterId)
}
