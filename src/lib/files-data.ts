import 'server-only'
import { db } from './db'
import { record } from './activity'
import * as r2 from './r2'
import { displayName, objectKey, rejectionFor, type FileKindKey } from './files'
import type { SessionUser } from './session'

/**
 * Uploading and reading files back.
 *
 * The flow is three steps rather than one, because the bytes do not come
 * through this application:
 *
 *   1. `begin`  — we check what they say they are sending, reserve a row and
 *                 hand back a presigned URL.
 *   2. the browser PUTs the bytes straight to R2.
 *   3. `finish` — we ask R2 what it actually received and either accept the
 *                 file or delete it.
 *
 * Step 3 is not a formality. A presigned PUT cannot express a size limit, so
 * until R2 has been asked, every number we hold about the file is the
 * uploader's own claim about it.
 */

export interface BeginInput {
  kind: FileKindKey
  name: string
  mime: string
  size: number
  eventId?: string | null
  payeeId?: string | null
  assetId?: string | null
  /** Which act's slot this is — a rider or stage plot for one act on this
   *  event. Leave unset for the venue spec, the promoter's own row (which
   *  uses payeeId instead) or a file nobody has attached to an act yet. */
  artistId?: string | null
  grantId?: string | null
  uploadedById?: string | null
}

export type BeginResult = { ok: true; fileId: string; url: string } | { ok: false; why: string }

/**
 * Reserve a place for a file and hand back somewhere to put it.
 *
 * The caller has already established that this user may write to this event —
 * that check belongs to the action, not here. What this does is decide
 * whether the *file* is acceptable, which is a different question.
 */
export async function begin(input: BeginInput): Promise<BeginResult> {
  if (!r2.isConfigured()) {
    return {
      ok: false,
      why: 'File storage is not set up yet. Ask an administrator to configure R2.',
    }
  }

  const rejection = rejectionFor(input.kind, input.mime, input.size)
  if (rejection) return { ok: false, why: rejection }

  const owner = input.eventId ?? input.payeeId ?? input.assetId ?? 'loose'
  const key = objectKey(input.kind, owner, input.name)

  const row = await db.storedFile.create({
    data: {
      key,
      name: displayName(input.name),
      mime: input.mime,
      size: input.size,
      // Filled in by `finish` from what R2 actually holds. Empty means the
      // upload was never completed.
      sha256: '',
      kind: input.kind,
      scan: 'PENDING',
      eventId: input.eventId ?? null,
      payeeId: input.payeeId ?? null,
      assetId: input.assetId ?? null,
      artistId: input.artistId ?? null,
      grantId: input.grantId ?? null,
      uploadedById: input.uploadedById ?? null,
    },
  })

  return { ok: true, fileId: row.id, url: await r2.uploadUrl(key, input.mime) }
}

export type FinishResult = { ok: true } | { ok: false; why: string }

/**
 * Accept a file, or throw it away.
 *
 * Everything checked here is checked against R2's account of the object
 * rather than the browser's. A file that overran its limit is deleted rather
 * than kept and flagged: we have no use for it, and keeping it would mean the
 * limit was a suggestion.
 */
export async function finish(fileId: string, actor?: SessionUser): Promise<FinishResult> {
  const row = await db.storedFile.findUnique({ where: { id: fileId } })
  if (!row) return { ok: false, why: 'That upload is not one we started.' }

  const actual = await r2.verify(row.key)
  if (!actual) {
    await db.storedFile.delete({ where: { id: fileId } })
    return { ok: false, why: 'The upload did not complete.' }
  }

  const rejection = rejectionFor(row.kind as FileKindKey, actual.mime, actual.size)
  if (rejection) {
    await r2.remove(row.key)
    await db.storedFile.update({ where: { id: fileId }, data: { scan: 'BLOCKED' } })
    return { ok: false, why: rejection }
  }

  // Replacing a rider supersedes the old one rather than overwriting it: the
  // tech who printed last week's copy needs the old one to still exist.
  //
  // eventId/payeeId/assetId are mutually exclusive owners, so each is only
  // compared when this file has one. artistId is different — a sub-scope
  // *within* an event, where many acts each keep their own current rider —
  // so it is always compared, including null against null, or an unassigned
  // upload would supersede (and hide) an act's already-attributed one.
  const supersedes = await db.storedFile.findMany({
    where: {
      id: { not: fileId },
      current: true,
      kind: row.kind,
      artistId: row.artistId,
      ...(row.eventId ? { eventId: row.eventId } : {}),
      ...(row.payeeId ? { payeeId: row.payeeId } : {}),
      ...(row.assetId ? { assetId: row.assetId } : {}),
    },
    select: { id: true, version: true },
  })

  const version = Math.max(0, ...supersedes.map((s) => s.version)) + 1

  await db.$transaction([
    db.storedFile.updateMany({
      where: { id: { in: supersedes.map((s) => s.id) } },
      data: { current: false },
    }),
    db.storedFile.update({
      where: { id: fileId },
      data: {
        scan: 'CLEAN',
        size: actual.size,
        mime: actual.mime,
        sha256: actual.etag,
        version,
        current: true,
      },
    }),
  ])

  if (row.eventId && actor) {
    const what = version > 1 ? 'replaced' : 'added'
    await record(row.eventId, actor, `${what} ${row.name}`)
  }

  return { ok: true }
}

export interface FileRow {
  id: string
  name: string
  kind: string
  mime: string
  size: number
  version: number
  at: Date
  uploadedBy: string | null
  /** Which act's slot this is on, when it is on one. See StoredFile.artistId. */
  artistId: string | null
  /** The payee it is filed against, if any — an act's persistent record, or
   *  the promoter's own documents. */
  payeeId: string | null
}

/** The current files on an event, newest kind-group first. */
export async function filesForEvent(eventId: string): Promise<FileRow[]> {
  const rows = await db.storedFile.findMany({
    where: { eventId, current: true, scan: 'CLEAN' },
    include: { uploadedBy: { select: { name: true } } },
    orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }],
  })

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    mime: r.mime,
    size: r.size,
    version: r.version,
    at: r.createdAt,
    uploadedBy: r.uploadedBy?.name ?? null,
    artistId: r.artistId,
    payeeId: r.payeeId,
  }))
}

/**
 * A link to read one file.
 *
 * Short-lived and always `attachment` — see `downloadUrl` in r2.ts. A file
 * that has not passed verification has no link at all rather than a link that
 * fails, so that nothing half-uploaded is ever offered to a reader.
 */
export async function linkTo(fileId: string): Promise<string | null> {
  const row = await db.storedFile.findUnique({ where: { id: fileId } })
  if (!row || row.scan !== 'CLEAN') return null
  return r2.downloadUrl(row.key, row.name, row.mime)
}

export type AttachResult = { ok: true } | { ok: false; why: string }

/**
 * Pick which act an unassigned file belongs to.
 *
 * Only ever moves a file *out* of "unassigned" — the caller is expected to
 * have already checked the file and the act both belong to the event in
 * question, which is a permissions question and not this function's to
 * answer. Refuses a file that is already on an act rather than silently
 * reassigning it: that is a different, louder mistake to make from a picker.
 */
export async function attachToArtist(fileId: string, artistId: string): Promise<AttachResult> {
  const row = await db.storedFile.findUnique({ where: { id: fileId } })
  if (!row) return { ok: false, why: 'That file no longer exists.' }
  if (row.artistId) return { ok: false, why: 'That file is already on an act.' }

  await db.storedFile.update({ where: { id: fileId }, data: { artistId } })
  return { ok: true }
}
