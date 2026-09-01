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
 * The Payee record for a promoter's organisation, created on first use.
 *
 * `User.promoter` is a name rather than a relation — see the note on
 * `Event.promoter` in the schema — so the name is the join key until that
 * migration happens.
 */
export async function ownPayee(user: SessionUser): Promise<{ id: string; name: string } | null> {
  if (!user.external || !user.promoter) return null

  const existing = await db.payee.findFirst({
    where: { kind: 'PROMOTER', name: user.promoter },
    select: { id: true, name: true },
  })
  if (existing) return existing

  return db.payee.create({
    data: { kind: 'PROMOTER', name: user.promoter, country: 'NZ' },
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
    orgName: user.promoter,
    events: rows.map((e) => ({
      id: e.id,
      name: e.name,
      date: dateLabel(e.date),
      stage: e.stage,
      awaitingSignOff: e.assets.filter((a) => a.state === 'REVIEW' && !a.promoterSigned).length,
    })),
  }
}
