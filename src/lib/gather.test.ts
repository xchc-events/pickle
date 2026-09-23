import { describe, expect, it, vi } from 'vitest'

// gather.ts is now `server-only` (it reads TicketSaleDay for `salesHistory`),
// which throws on import outside Next.js's own build. Stubbed the same way
// holds-data.test.ts stubs it, so a module that is fine to unit test keeps
// being importable in vitest.
vi.mock('server-only', () => ({}))

const findMany = vi.fn()
vi.mock('./db', () => ({ db: { ticketSaleDay: { findMany } } }))

const { readSales, salesHistory } = await import('./gather')

/**
 * `readSales` is the one place Ticketing reads how many have sold. Today it
 * is a stub over the event's own row rather than a real call to Gather.rsvp
 * (docs/gather-rsvp-api.md, section 3.1 "Event summary"), but everything that
 * wants a sold count goes through it, so the day a real client exists it is
 * the only thing that changes.
 */
describe('readSales', () => {
  it("reads the sold count and the read time off the event's row", () => {
    const updatedAt = new Date('2026-09-22T16:10:00+12:00')
    expect(readSales({ sold: 78, updatedAt })).toEqual({ sold: 78, readAt: updatedAt })
  })

  it('is shaped like the API brief’s event summary — a sold count and when it was true', () => {
    const result = readSales({ sold: 0, updatedAt: new Date('2026-01-01T00:00:00+13:00') })
    expect(Object.keys(result).sort()).toEqual(['readAt', 'sold'])
  })

  it('carries zero sold rather than treating it as missing', () => {
    const updatedAt = new Date('2026-09-01T09:00:00+12:00')
    expect(readSales({ sold: 0, updatedAt }).sold).toBe(0)
  })
})

/**
 * `salesHistory` is the sales-over-time graph's one read: the daily,
 * per-tier breakdown behind `readSales`' total. The table read is a thin
 * stand-in, the same as `readSales`, so what is worth checking is that it
 * scopes to the right event and asks for days in order — not the query
 * engine underneath it.
 */
describe('salesHistory', () => {
  it('reads only the given event, oldest day first', async () => {
    findMany.mockResolvedValueOnce([])

    await salesHistory('sf')

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: 'sf' }, orderBy: { day: 'asc' } }),
    )
  })

  it('hands back exactly what the table gives it', async () => {
    const rows = [{ day: new Date('2026-09-01T12:00:00Z'), tier: 'std', sold: 12 }]
    findMany.mockResolvedValueOnce(rows)

    await expect(salesHistory('sf')).resolves.toEqual(rows)
  })
})
