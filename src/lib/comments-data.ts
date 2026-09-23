import 'server-only'
import { db } from './db'
import { record } from './activity'
import { assetSpec } from './design'
import { ago } from './format'
import type { SessionUser } from './session'

/**
 * D5 — a comment thread under a piece of design, or the event's general
 * design thread when there is no piece.
 *
 * Shared by Design and the promoter portal: each surface's own actions
 * check their own module and event scope, then call straight into this —
 * the same shape `record` in activity.ts is shared by every module's
 * actions. Keeping the write in one place is what makes "every comment is
 * also an activity line" true regardless of which screen posted it.
 */

export interface CommentRow {
  id: string
  who: string
  body: string
  /** `ago()`, computed once here so Design and the portal cannot disagree. */
  atLabel: string
}

/**
 * Post a comment, either under one piece of the set (`key`) or on the
 * event's general design thread (`key` is null).
 *
 * Commenting on a piece that has no `Asset` row yet creates one at DRAFT —
 * the same upsert `approveAsset`'s sign-off and `beginArtworkUpload` use,
 * because a comment is just as good a reason for the piece to exist as a
 * file or a decision is.
 */
export async function postComment(
  eventId: string,
  key: string | null,
  user: SessionUser,
  body: string,
): Promise<{ ok: true } | { ok: false; why: string }> {
  const text = body.trim()
  if (!text) return { ok: false, why: 'Say something first.' }

  let assetId: string | null = null
  let label = 'the general design thread'
  if (key !== null) {
    const spec = assetSpec(key)
    if (!spec) return { ok: false, why: 'That is not a piece of the set.' }
    const asset = await db.asset.upsert({
      where: { eventId_key: { eventId, key } },
      create: { eventId, key },
      update: {},
      select: { id: true },
    })
    assetId = asset.id
    label = spec.name
  }

  await db.comment.create({
    data: { eventId, assetId, authorId: user.id, who: user.initials, body: text },
  })
  await record(eventId, user, `commented on ${label}: ${text}`)

  return { ok: true }
}

/**
 * Every comment on an event, split into per-piece threads (keyed by
 * `Asset.id`, the way `row.assets` on the Design and portal loaders already
 * carry them) and the general thread.
 */
export async function commentsFor(
  eventId: string,
): Promise<{ byAsset: Map<string, CommentRow[]>; general: CommentRow[] }> {
  const rows = await db.comment.findMany({ where: { eventId }, orderBy: { at: 'asc' } })

  const byAsset = new Map<string, CommentRow[]>()
  const general: CommentRow[] = []
  for (const r of rows) {
    const row: CommentRow = { id: r.id, who: r.who, body: r.body, atLabel: ago(r.at) }
    if (r.assetId) {
      const list = byAsset.get(r.assetId) ?? []
      list.push(row)
      byAsset.set(r.assetId, list)
    } else {
      general.push(row)
    }
  }
  return { byAsset, general }
}
