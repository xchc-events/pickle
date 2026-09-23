/**
 * Tech production's per-act file structure, and the counts over it.
 *
 * Connor, 23 Sep 2026: "The only details we want to see here are tech riders
 * and stage plots. These two want to be per artist, and you can have a
 * section for the promoter as well." Which rows a live act's slot has, how
 * the promoter's own row differs, and what the queue's have/need counts are —
 * pure and tested here, over the flat rows `tech-data.ts` reads. That file is
 * the part that talks to the database; this only shapes what it is given.
 */

import type { FileRow } from './files-data'

export interface LiveArtist {
  id: string
  name: string
}

/** One act's slot: its own rider and stage plot, or nothing yet. */
export interface ActFiles {
  id: string
  name: string
  rider: FileRow | null
  stagePlot: FileRow | null
}

const slotOf = (
  files: readonly FileRow[],
  kind: string,
  match: (f: FileRow) => boolean,
): FileRow | null => files.find((f) => f.kind === kind && match(f)) ?? null

/** One row per live act, each carrying only its own rider and stage plot. */
export function actFileRows(acts: readonly LiveArtist[], files: readonly FileRow[]): ActFiles[] {
  return acts.map((a) => {
    const isTheirs = (f: FileRow) => f.artistId === a.id
    return {
      id: a.id,
      name: a.name,
      rider: slotOf(files, 'RIDER_TECH', isTheirs),
      stagePlot: slotOf(files, 'STAGE_PLOT', isTheirs),
    }
  })
}

/**
 * The promoter's own rider and stage plot — not an act, so sourced from
 * their payee record (`payeeId`) rather than a slot (`artistId`). Null when
 * this event has no promoter payee to ask.
 */
export function promoterFileRow(
  promoterPayeeId: string | null,
  promoterName: string,
  files: readonly FileRow[],
): ActFiles | null {
  if (!promoterPayeeId) return null
  const isTheirs = (f: FileRow) => f.artistId === null && f.payeeId === promoterPayeeId
  return {
    id: promoterPayeeId,
    name: promoterName,
    rider: slotOf(files, 'RIDER_TECH', isTheirs),
    stagePlot: slotOf(files, 'STAGE_PLOT', isTheirs),
  }
}

/**
 * Riders and stage plots nobody has attached to an act yet.
 *
 * Everything uploaded before this existed has no artistId, and stays under
 * "unassigned" until somebody picks which act it belongs to — a file is not
 * on an act's row just because it landed on the event. Whichever of these the
 * promoter's own row just claimed is excluded, so nothing shows twice.
 */
export function unassignedFiles(
  files: readonly FileRow[],
  promoterPayeeId: string | null,
): FileRow[] {
  return files.filter((f) => {
    if (f.kind !== 'RIDER_TECH' && f.kind !== 'STAGE_PLOT') return false
    if (f.artistId !== null) return false
    const isPromoters = promoterPayeeId !== null && f.payeeId === promoterPayeeId
    return !isPromoters
  })
}

export interface TechTally {
  have: number
  need: number
  tone: 'good' | 'warn' | 'stop'
  note: string
}

function tallyOf(have: number, need: number): TechTally {
  return {
    have,
    need,
    tone: have === need ? 'good' : have === 0 ? 'stop' : 'warn',
    note:
      have === need
        ? need === 0
          ? 'no acts yet'
          : 'everything in'
        : have === 0
          ? 'nothing in yet'
          : `${need - have} still to come`,
  }
}

/**
 * The queue's have/need for one event: two slots, rider and stage plot, for
 * every live act. Nothing else on the page counts towards it — the
 * promoter's documents and the venue spec are shown, not chased the way an
 * act's own rider is.
 *
 * `present` is one entry per filled slot, which may include duplicates or
 * slots for acts no longer live; both are de-duplicated against `liveActCount`
 * rather than assumed away, since it is read off a separate query.
 */
export function actFileTally(
  liveActCount: number,
  present: readonly { artistId: string; kind: string }[],
): TechTally {
  const have = new Set(present.map((p) => `${p.artistId}:${p.kind}`)).size
  return tallyOf(Math.min(have, liveActCount * 2), liveActCount * 2)
}
