import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { dateLabel } from './format'
import { maskedPayee, type MaskedPayee } from './payments-data'
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

export interface PortalEvent {
  id: string
  name: string
  date: string
  stage: number
  /** Pieces of the set still waiting on this promoter's sign-off. */
  awaitingSignOff: number
}

export interface PortalLoad {
  payee: MaskedPayee | null
  orgName: string | null
  events: PortalEvent[]
}

export async function loadPortal(user: SessionUser): Promise<PortalLoad> {
  const own = await ownPayee(user)

  // Scoped in the query, like everywhere else. An external user with no org
  // matches nothing rather than everything — see src/lib/scope.ts.
  const rows = await db.event.findMany({
    where: { AND: [{ concluded: false }, eventScope(user)] },
    orderBy: { date: 'asc' },
    select: {
      id: true,
      name: true,
      date: true,
      stage: true,
      assets: { select: { key: true, state: true, promoterSigned: true } },
    },
    take: 20,
  })

  return {
    payee: own ? await maskedPayee(own.id) : null,
    orgName: user.organisationName,
    events: rows.map((e) => ({
      id: e.id,
      name: e.name,
      date: dateLabel(e.date),
      stage: e.stage,
      awaitingSignOff: e.assets.filter((a) => a.state === 'REVIEW' && !a.promoterSigned).length,
    })),
  }
}
