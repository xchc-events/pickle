import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { dateLabel } from './format'
import { filesForEvent, type FileRow } from './files-data'
import { maskAccount } from './payments'
import { grantStatus } from './grants'
import type { SessionUser } from './session'

/**
 * Loads Tech production.
 *
 * The module answers one question for a tech lead the week of a show: is
 * everything here that I need to rig this, and if not, who do I chase. So the
 * shape of what it loads is "what is missing", not "what exists" — an event
 * with no rider is the interesting row, and it has nothing in it.
 */

/** What the crew needs on every event, in the order they need it. */
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
    kind: 'RIDER_HOSPITALITY',
    name: 'Hospitality rider',
    why: 'Green room and catering. Not the crew’s job, but it arrives with the rest.',
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
  /** How many of the tech set are present. */
  have: number
  need: number
  tone: 'good' | 'warn' | 'stop'
  note: string
}

export interface TechArtist {
  id: string
  name: string
  status: string
  /** Null when the act has never been linked to a payee record. */
  payeeId: string | null
  payeeName: string | null
  account: string
  detailsOnFile: boolean
  /** An open link already sent to them, if there is one. */
  openGrant: boolean
}

export interface TechEvent {
  id: string
  name: string
  date: string
  spaceName: string
  format: string
  files: FileRow[]
  missing: { kind: string; name: string; why: string }[]
  artists: TechArtist[]
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
  // Confirmed onwards. Rigging an event that has not been agreed is work done
  // on a show that may not happen.
  const events = await db.event.findMany({
    where: { AND: [{ stage: { gte: 2 }, concluded: false }, eventScope(user)] },
    orderBy: { date: 'asc' },
    select: { id: true, name: true, date: true },
    take: 30,
  })

  const ids = events.map((e) => e.id)
  const present = await db.storedFile.groupBy({
    by: ['eventId', 'kind'],
    where: { eventId: { in: ids }, current: true, scan: 'CLEAN' },
    _count: true,
  })

  const need = TECH_SET.length
  const queue: TechQueueRow[] = events.map((e) => {
    const have = TECH_SET.filter((s) =>
      present.some((p) => p.eventId === e.id && p.kind === s.kind),
    ).length

    return {
      id: e.id,
      name: e.name,
      date: dateLabel(e.date),
      have,
      need,
      tone: have === need ? 'good' : have === 0 ? 'stop' : 'warn',
      note:
        have === need
          ? 'everything in'
          : have === 0
            ? 'nothing in yet'
            : `${need - have} still to come`,
    }
  })

  const chosen = wantedId && ids.includes(wantedId) ? wantedId : (ids[0] ?? null)
  if (!chosen) return { queue, event: null, storageReady }

  const row = await db.event.findUniqueOrThrow({
    where: { id: chosen },
    include: {
      space: { select: { name: true } },
      artists: {
        orderBy: { order: 'asc' },
        include: {
          payee: {
            select: {
              id: true,
              name: true,
              bankTail: true,
              bankEnc: true,
              grants: { select: { expires: true, usedAt: true, revokedAt: true } },
            },
          },
        },
      },
    },
  })

  const files = await filesForEvent(chosen)
  const now = new Date()

  return {
    queue,
    storageReady,
    event: {
      id: row.id,
      name: row.name,
      date: dateLabel(row.date),
      spaceName: row.space.name,
      format: row.format,
      files,
      missing: TECH_SET.filter((s) => !files.some((f) => f.kind === s.kind)).map((s) => ({
        kind: s.kind,
        name: s.name,
        why: s.why,
      })),
      artists: row.artists.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status.toLowerCase(),
        payeeId: a.payee?.id ?? null,
        payeeName: a.payee?.name ?? null,
        account: maskAccount(a.payee?.bankTail ?? null),
        detailsOnFile: a.payee?.bankEnc != null,
        openGrant: (a.payee?.grants ?? []).some((g) => grantStatus(g, now) === 'open'),
      })),
    },
  }
}
