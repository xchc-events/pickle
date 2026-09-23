import 'server-only'
import { db } from './db'
import { seedRunSheetRows, type EventRunTimes, type RunSheetRow } from './run-sheet'

/**
 * The tech run sheet's rows, and the record of what has actually been sent
 * — the database side of src/lib/run-sheet.ts's pure assembly.
 */

/**
 * The rows to show: what has been saved, or — for an event nobody has
 * touched a run sheet on yet — the seed built from its own times. The seed
 * is never written here; `saveRunSheet` is what makes it real.
 */
export async function runSheetFor(eventId: string, times: EventRunTimes): Promise<RunSheetRow[]> {
  const rows = await db.runSheetItem.findMany({
    where: { eventId },
    orderBy: { order: 'asc' },
  })
  if (rows.length === 0) return seedRunSheetRows(times)

  return rows.map((r) => ({ id: r.id, time: r.time, item: r.item, who: r.who, note: r.note, order: r.order }))
}

/**
 * Replace this event's run sheet with exactly these rows, in this order.
 * One transaction — the tech lead's add, remove, reorder and in-place edits
 * all land as one save, so a half-applied reorder is never visible.
 */
export async function saveRunSheetRows(
  eventId: string,
  rows: readonly Pick<RunSheetRow, 'time' | 'item' | 'who' | 'note'>[],
): Promise<void> {
  await db.$transaction([
    db.runSheetItem.deleteMany({ where: { eventId } }),
    db.runSheetItem.createMany({
      data: rows.map((r, i) => ({
        eventId,
        time: r.time,
        item: r.item,
        who: r.who,
        note: r.note,
        order: i,
      })),
    }),
  ])
}

export interface RunSheetSendSummary {
  recipientNames: string[]
  sentByName: string | null
  sentAt: Date
}

/** The most recent send for this event, or null for none yet. */
export async function latestRunSheetSend(eventId: string): Promise<RunSheetSendSummary | null> {
  const row = await db.runSheetSend.findFirst({
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

/** For the promoter's portal: has this event's run sheet ever been shared with them. */
export async function runSheetEverSent(eventId: string): Promise<boolean> {
  const row = await db.runSheetSend.findFirst({ where: { eventId }, select: { id: true } })
  return row !== null
}
