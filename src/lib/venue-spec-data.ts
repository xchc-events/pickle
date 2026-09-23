import 'server-only'
import { db } from './db'
import type { VenueSpecComponentRow } from './venue-spec'

/**
 * The venue spec house table, and the record of what has actually been sent
 * — the database side of src/lib/venue-spec.ts's pure assembly.
 */

/** Every component, active or not — Admin edits both; Tech only ticks the active ones. */
export async function loadVenueSpecComponents(): Promise<VenueSpecComponentRow[]> {
  const rows = await db.venueSpecComponent.findMany({ orderBy: { order: 'asc' } })
  return rows.map((r) => ({
    key: r.key,
    title: r.title,
    body: r.body,
    order: r.order,
    active: r.active,
  }))
}

export interface VenueSpecSendSummary {
  recipientNames: string[]
  sentByName: string | null
  sentAt: Date
}

/**
 * The most recent send for this event, or null for none yet — what turns
 * the Tech row from "Send the venue spec" into "sent to … on …". Recipient
 * names are read off `Payee` as it stands today, not frozen at send time —
 * unlike the text itself (`VenueSpecSend.text`), a name is the one-record
 * kind of fact that is meant to stay current, the same as anywhere else a
 * payee's name is shown.
 */
export async function latestVenueSpecSend(eventId: string): Promise<VenueSpecSendSummary | null> {
  const row = await db.venueSpecSend.findFirst({
    where: { eventId },
    orderBy: { sentAt: 'desc' },
    select: { payeeIds: true, sentAt: true, sentBy: { select: { name: true } } },
  })
  if (!row) return null

  const payees = row.payeeIds.length
    ? await db.payee.findMany({ where: { id: { in: row.payeeIds } }, select: { name: true } })
    : []

  return {
    recipientNames: payees.map((p) => p.name),
    sentByName: row.sentBy?.name ?? null,
    sentAt: row.sentAt,
  }
}
