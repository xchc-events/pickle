import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { dateLabel } from './format'
import { filesForEvent, type FileRow } from './files-data'
import { actFileRows, actFileTally, promoterFileRow, unassignedFiles, type ActFiles } from './tech'
import type { SessionUser } from './session'

/**
 * Loads Tech production.
 *
 * The module answers one question for a tech lead the week of a show: is
 * everything here that I need to rig this, and if not, who do I chase.
 * Riders and stage plots are per act — see `tech.ts` — so "what is missing"
 * now reads per act's own two slots rather than per event.
 */

/** What the crew needs, in the order they need it. Tech rider and stage plot
 *  are per act now (see `ActFiles`); this still names all three kinds for
 *  the venue spec row and for labelling an unassigned file's kind. */
export const TECH_SET = [
  {
    kind: 'RIDER_TECH',
    name: 'Tech rider',
    why: 'Backline, inputs, monitoring. Without it the rig is guesswork on the day.',
  },
  {
    kind: 'STAGE_PLOT',
    name: 'Stage plot',
    why: 'Where people stand. Decides the monitor count and the cable run.',
  },
  {
    kind: 'TECH_SPEC',
    name: 'Venue spec sent',
    why: 'What XCHC sends them. Proof the act knew the room before they arrived.',
  },
] as const

export interface TechQueueRow {
  id: string
  name: string
  date: string
  /** Rider and stage plot slots filled, across every live act. */
  have: number
  need: number
  tone: 'good' | 'warn' | 'stop'
  note: string
}

export interface TechEvent {
  id: string
  name: string
  date: string
  spaceName: string
  format: string
  /** One row per live act, each with its own rider and stage plot. */
  acts: ActFiles[]
  /** The promoter's own rider and stage plot, when this event has a
   *  promoter payee to ask. */
  promoter: ActFiles | null
  /** TECH_SPEC — what XCHC sent them. Unchanged from wave one. */
  venueSpec: FileRow | null
  /** Riders and stage plots nobody has attached to an act yet. */
  unassigned: FileRow[]
}

export interface TechLoad {
  queue: TechQueueRow[]
  event: TechEvent | null
  storageReady: boolean
}

/**
 * The queue, and one event in detail.
 *
 * Scoped in the query rather than after it, like everywhere else — an
 * external promoter never sees an event that is not theirs, and the rows
 * never leave the database in the first place. See src/lib/scope.ts.
 */
export async function loadTech(
  user: SessionUser,
  wantedId: string | undefined,
  storageReady: boolean,
): Promise<TechLoad> {
  // Every live event, confirmed or not. Tech used to start at Confirmed; each
  // part of an event now moves on its own, and riders and stage plots arrive
  // when they arrive — often with the enquiry.
  const events = await db.event.findMany({
    where: { AND: [{ concluded: false }, eventScope(user)] },
    orderBy: { date: 'asc' },
    select: { id: true, name: true, date: true },
    take: 30,
  })

  const ids = events.map((e) => e.id)

  // Declined acts are not chased for a rider nobody will use.
  const liveArtists = await db.eventArtist.findMany({
    where: { eventId: { in: ids }, status: { not: 'DECLINED' } },
    select: { eventId: true },
  })
  const liveCountOf = new Map<string, number>()
  for (const a of liveArtists) liveCountOf.set(a.eventId, (liveCountOf.get(a.eventId) ?? 0) + 1)

  // Which (act, kind) slots are filled, across the whole queue in one query
  // rather than one per event.
  const presentRows = await db.storedFile.findMany({
    where: {
      eventId: { in: ids },
      artistId: { not: null },
      kind: { in: ['RIDER_TECH', 'STAGE_PLOT'] },
      current: true,
      scan: 'CLEAN',
    },
    select: { eventId: true, artistId: true, kind: true },
  })
  const presentByEvent = new Map<string, { artistId: string; kind: string }[]>()
  for (const r of presentRows) {
    // Both are filtered non-null in the where clause above; StoredFile's own
    // columns are still nullable, so TS needs telling here too.
    if (!r.eventId || !r.artistId) continue
    const list = presentByEvent.get(r.eventId) ?? []
    list.push({ artistId: r.artistId, kind: r.kind })
    presentByEvent.set(r.eventId, list)
  }

  const queue: TechQueueRow[] = events.map((e) => {
    const tally = actFileTally(liveCountOf.get(e.id) ?? 0, presentByEvent.get(e.id) ?? [])
    return { id: e.id, name: e.name, date: dateLabel(e.date), ...tally }
  })

  const chosen = wantedId && ids.includes(wantedId) ? wantedId : (ids[0] ?? null)
  if (!chosen) return { queue, event: null, storageReady }

  const row = await db.event.findUniqueOrThrow({
    where: { id: chosen },
    include: {
      space: { select: { name: true } },
      artists: {
        where: { status: { not: 'DECLINED' } },
        orderBy: { order: 'asc' },
        select: { id: true, name: true },
      },
      promoterPayee: { select: { id: true, name: true } },
    },
  })

  const files = await filesForEvent(chosen)
  const promoterId = row.promoterPayee?.id ?? null

  return {
    queue,
    storageReady,
    event: {
      id: row.id,
      name: row.name,
      date: dateLabel(row.date),
      spaceName: row.space.name,
      format: row.format,
      acts: actFileRows(row.artists, files),
      promoter: promoterFileRow(promoterId, row.promoterPayee?.name ?? '', files),
      venueSpec: files.find((f) => f.kind === 'TECH_SPEC') ?? null,
      unassigned: unassignedFiles(files, promoterId),
    },
  }
}
