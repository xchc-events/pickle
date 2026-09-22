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
