import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { dateLabel } from './format'
import { maskedPayee, type MaskedPayee } from './payments-data'
import { ASSET_KEYS, assetSpec } from './design'
import { commentsFor, type CommentRow } from './comments-data'
import { bookingStep, type BookingStatus } from './parts'
import type { SessionUser } from './session'

/**
 * The external promoter's own view.
 *
 * `ownPayee` deliberately lives here rather than in the portal's actions
 * file. Anything exported from a `'use server'` module becomes an endpoint
 * the browser can call with arguments of its choosing — and a function that
 * takes a user and returns that user's payee would then accept *any* user.
 * Keeping it here means it can only be reached from code that already knows
 * who is asking.
 */

/**
 * The organisation this user acts for.
 *
 * A plain read now, where it used to look a Payee up by name and create one if
 * it was missing. Both of those were consequences of scoping on a name: the
 * organisation is created by the migration or by a coordinator in Admin, and a
 * user who is not linked to one sees nothing rather than silently minting an
 * organisation for themselves.
 */
export async function ownPayee(user: SessionUser): Promise<{ id: string; name: string } | null> {
  if (!user.external || !user.organisationId) return null

  return db.payee.findFirst({
    where: { id: user.organisationId, kind: 'PROMOTER' },
    select: { id: true, name: true },
  })
}

/** One piece of the set, waiting on this promoter's eye or already signed off. */
export interface PortalAssetCard {
  key: string
  name: string
  spec: string
  state: 'review' | 'approved'
  file: { id: string; name: string; version: number } | null
  comments: CommentRow[]
}

export interface PortalEvent {
  id: string
  name: string
  date: string
  /**
   * Where the booking stands — the part a promoter is party to. The rest of
   * an event's parts are the venue's own work, shown on the Pipeline.
   */
  bookingLabel: string
  /** Pieces of the set still waiting on this promoter's sign-off. */
  awaitingSignOff: number
  /**
   * Every piece past DRAFT — in review (needs a decision) or already signed
   * off (can be reopened). A draft is somebody's work in progress and is
   * not shown here, the same way Design does not make it actionable.
   */
  pieces: PortalAssetCard[]
  /** D5 — this event's general design thread, not tied to one piece. */
  generalComments: CommentRow[]
}

export interface PortalLoad {
  payee: MaskedPayee | null
  orgName: string | null
  events: PortalEvent[]
}

export async function loadPortal(user: SessionUser): Promise<PortalLoad> {
  const own = await ownPayee(user)

  // Scoped in the query, like everywhere else. An external user with no org
  // matches nothing rather than everything — see src/lib/scope.ts. Every
  // event that reaches this list is therefore already this promoter's own,
  // which is what `maySignOff` in design.ts checks before any of the
  // actions below actually write anything.
  const rows = await db.event.findMany({
    where: { AND: [{ concluded: false }, eventScope(user)] },
    orderBy: { date: 'asc' },
    select: {
      id: true,
      name: true,
      date: true,
      bookingStatus: true,
      assets: {
        where: { state: { not: 'DRAFT' } },
        select: { id: true, key: true, state: true },
      },
    },
    take: 20,
  })

  const assetIds = rows.flatMap((e) => e.assets.map((a) => a.id))
  const [files, commentsByEvent] = await Promise.all([
    assetIds.length
      ? db.storedFile.findMany({
          where: { assetId: { in: assetIds }, kind: 'ARTWORK', current: true, scan: 'CLEAN' },
          select: { id: true, name: true, version: true, assetId: true },
        })
      : Promise.resolve([]),
    Promise.all(rows.map((e) => commentsFor(e.id))),
  ])
  const fileByAsset = new Map(files.filter((f) => f.assetId).map((f) => [f.assetId!, f]))

  return {
    payee: own ? await maskedPayee(own.id) : null,
    orgName: user.organisationName,
    events: rows.map((e, i) => {
      const comments = commentsByEvent[i]!
      const pieces: PortalAssetCard[] = e.assets
        .map((a) => {
          const spec = assetSpec(a.key)
          if (!spec) return null
          const file = fileByAsset.get(a.id)
          return {
            key: a.key,
            name: spec.name,
            spec: spec.spec,
            state: a.state.toLowerCase() as 'review' | 'approved',
            file: file ? { id: file.id, name: file.name, version: file.version } : null,
            comments: comments.byAsset.get(a.id) ?? [],
          }
        })
        .filter((p): p is PortalAssetCard => p !== null)
        // House order (hero, then lead, then support) — the same order the
        // set is checked off in on Design, not whatever order the rows
        // happen to sit in.
        .sort((a, b) => ASSET_KEYS.indexOf(a.key) - ASSET_KEYS.indexOf(b.key))

      return {
        id: e.id,
        name: e.name,
        date: dateLabel(e.date),
        bookingLabel: bookingStep(e.bookingStatus.toLowerCase() as BookingStatus).label,
        awaitingSignOff: pieces.filter((p) => p.state === 'review').length,
        pieces,
        generalComments: comments.general,
      }
    }),
  }
}
