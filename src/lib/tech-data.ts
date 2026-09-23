import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { dateLabel } from './format'
import { filesForEvent, type FileRow } from './files-data'
import { actFileRows, actFileTally, promoterFileRow, unassignedFiles, type ActFiles } from './tech'
import { tickableComponents, type VenueSpecComponentRow } from './venue-spec'
import { loadVenueSpecComponents, latestVenueSpecSend, type VenueSpecSendSummary } from './venue-spec-data'
import type { EventRunTimes, RunSheetRow } from './run-sheet'
import { runSheetFor, latestRunSheetSend, type RunSheetSendSummary } from './run-sheet-data'
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
 *  are per act now (see `ActFiles`); this still names both kinds for
 *  labelling an unassigned file's kind.
 *
 *  Changed 23 Sep 2026: `TECH_SPEC` — "Venue spec sent" — dropped out of this
 *  set with the upload it named. The venue spec is composed and emailed now;
 *  see `VenueSpecComponent` and `sendVenueSpec` in
 *  src/app/(app)/tech/actions.ts. */
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
  /** Riders and stage plots nobody has attached to an act yet. */
  unassigned: FileRow[]
  /** The active components Tech may tick to send, house order. */
  venueSpecComponents: VenueSpecComponentRow[]
  /** Who a venue spec or a run sheet can go to: every live act with an
   *  email on its payee, then the promoter. */
  recipients: EventRecipient[]
  /** What "sent" means now — the most recent send, or null for none yet. */
  latestVenueSpecSend: VenueSpecSendSummary | null
  /** Saved rows, or — for an event nobody has touched a run sheet on yet —
   *  the seed built from the event's own times. */
  runSheet: RunSheetRow[]
  latestRunSheetSend: RunSheetSendSummary | null
}

export interface TechLoad {
  queue: TechQueueRow[]
  event: TechEvent | null
  storageReady: boolean
}

export interface EventRecipient {
  payeeId: string
  /** The act's own display name, or the promoter's payee name — not
   *  necessarily the payee's own `name`, which Tech does not otherwise
   *  show; see `tech.ts` on why an act is shown by its own name. */
  name: string
  email: string | null
  kind: 'act' | 'promoter'
}

/**
 * Who a venue spec or a run sheet can go to on this event: every live act
 * with an email on its payee, then the promoter, if this event has one.
 *
 * Connor, 23 Sep 2026: "tick the components, pick the recipients (each act
 * with an email on its payee, the promoter)." An act with no payee linked,
 * or a payee with no email, is not offered — see `recipientsMissingEmail`
 * in src/lib/venue-spec.ts for the send action's own re-check, since a
 * candidate list here is not itself the security boundary.
 */
export async function eventRecipients(eventId: string): Promise<EventRecipient[]> {
  const [acts, event] = await Promise.all([
    db.eventArtist.findMany({
      where: { eventId, status: { not: 'DECLINED' }, payeeId: { not: null } },
      select: { name: true, payee: { select: { id: true, email: true } } },
    }),
    db.event.findUnique({
      where: { id: eventId },
      select: { promoterPayee: { select: { id: true, name: true, email: true } } },
    }),
  ])

  const recipients: EventRecipient[] = []
  const seen = new Set<string>()
  for (const a of acts) {
    if (!a.payee || seen.has(a.payee.id)) continue
    seen.add(a.payee.id)
    recipients.push({ payeeId: a.payee.id, name: a.name, email: a.payee.email, kind: 'act' })
  }
  if (event?.promoterPayee && !seen.has(event.promoterPayee.id)) {
    recipients.push({
      payeeId: event.promoterPayee.id,
      name: event.promoterPayee.name,
      email: event.promoterPayee.email,
      kind: 'promoter',
    })
  }
  return recipients
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

  const times: EventRunTimes = {
    packIn: row.packIn,
    doors: row.doors,
    barClose: row.barClose,
    allOut: row.allOut,
    packOut: row.packOut,
  }

  const [files, venueSpecComponents, recipients, venueSpecSend, runSheet, runSheetSend] =
    await Promise.all([
      filesForEvent(chosen),
      loadVenueSpecComponents(),
      eventRecipients(chosen),
      latestVenueSpecSend(chosen),
      runSheetFor(chosen, times),
      latestRunSheetSend(chosen),
    ])
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
      unassigned: unassignedFiles(files, promoterId),
      venueSpecComponents: tickableComponents(venueSpecComponents),
      recipients,
      latestVenueSpecSend: venueSpecSend,
      runSheet,
      latestRunSheetSend: runSheetSend,
    },
  }
}
