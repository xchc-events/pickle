import 'server-only'
import { db } from './db'

/**
 * Ticket sales, read from Gather.rsvp.
 *
 * Gather is where XCHC sells tickets, and Pickle treats it as the source of
 * truth for how many have sold (docs/gather-rsvp-api.md, section 1). There is
 * no real client yet — the brief in that document has not been built against
 * — so this reads the same two figures off the event's own row that a real
 * "event summary" call would return (section 3.1): `sold`, which nothing but
 * the seed sets any more, and `readAt`, standing in for that endpoint's
 * `updated_at`.
 *
 * Everything that wants a sold count calls this rather than reading
 * `Event.sold` directly, so the day a real client exists it is the only thing
 * that changes — nothing that calls `readSales` has to.
 */

export interface GatherSalesRead {
  /** Paid tickets sold. Comps and holds are not sales; see section 5. */
  sold: number
  /** When this figure was last known true. */
  readAt: Date
}

export function readSales(event: { sold: number; updatedAt: Date }): GatherSalesRead {
  return { sold: event.sold, readAt: event.updatedAt }
}

/** One tier's ticket sales on one day. Not a running total — see `salesHistory`. */
export interface GatherSalesDay {
  day: Date
  /** sub | std | sup | door — `MixKey` in src/lib/ticketing.ts. */
  tier: string
  sold: number
}

/**
 * The sales history behind `readSales`' total, broken out by day and tier.
 *
 * Draws the sales-over-time graph on Ticketing. The same stand-in as
 * `readSales`: there is no real Gather.rsvp client yet, so this reads
 * `TicketSaleDay`, the table the seed writes a plausible history into, in
 * place of the real "orders" read (docs/gather-rsvp-api.md, section 3.2).
 * Everything that wants the curve calls this rather than the table directly,
 * so the day a real client exists it is the only thing that changes.
 */
export async function salesHistory(eventId: string): Promise<GatherSalesDay[]> {
  return db.ticketSaleDay.findMany({
    where: { eventId },
    orderBy: { day: 'asc' },
    select: { day: true, tier: true, sold: true },
  })
}
