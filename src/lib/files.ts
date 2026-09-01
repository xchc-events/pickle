import { randomBytes } from 'node:crypto'

/**
 * What may be uploaded, and under what key.
 *
 * Pure functions, so the rules that decide what gets into the bucket can be
 * tested without a bucket. The R2 calls themselves are in `r2.ts`; the
 * permission checks are in the actions that call both.
 *
 * Two rules here are load-bearing rather than tidy:
 *
 *  - An uploader's filename never reaches the object key. It is theirs to
 *    choose, it arrives from outside the venue, and a key built from it is a
 *    key that can be walked into somebody else's prefix.
 *  - SVG is accepted only for the venue's own brand marks. An SVG is a
 *    document that can carry script, and BRAND is the one kind that no
 *    external grant can write to.
 */

export type FileKindKey =
  | 'RIDER_HOSPITALITY'
  | 'RIDER_TECH'
  | 'STAGE_PLOT'
  | 'TECH_SPEC'
  | 'PRESS_SHOT'
  | 'BIO'
  | 'EPK'
  | 'ARTWORK'
  | 'BRAND'
  | 'OTHER'

const MB = 1024 * 1024

/** Ceilings per kind. Generous for artwork, tight for anything a person types. */
export const MAX_BYTES: Record<FileKindKey, number> = {
  RIDER_HOSPITALITY: 25 * MB,
  RIDER_TECH: 25 * MB,
  STAGE_PLOT: 25 * MB,
  TECH_SPEC: 25 * MB,
  PRESS_SHOT: 50 * MB,
  BIO: 10 * MB,
  EPK: 100 * MB,
  // Two 9:16 cuts and an A2 print PDF. The print file is the big one.
  ARTWORK: 500 * MB,
  BRAND: 100 * MB,
  OTHER: 50 * MB,
}

const DOCS = ['application/pdf', 'application/msword', 'text/plain', 'text/markdown']
const WORD = ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
const STILLS = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
const VIDEO = ['video/mp4', 'video/quicktime', 'video/webm']

/** Accepted types per kind. Absent from this map means nothing is accepted. */
const ACCEPTS: Record<FileKindKey, readonly string[]> = {
  RIDER_HOSPITALITY: [...DOCS, ...WORD],
  RIDER_TECH: [...DOCS, ...WORD, ...STILLS],
  STAGE_PLOT: [...DOCS, ...STILLS],
  TECH_SPEC: [...DOCS, ...WORD, ...STILLS],
  PRESS_SHOT: STILLS,
  BIO: [...DOCS, ...WORD],
  EPK: [...DOCS, ...WORD, ...STILLS, ...VIDEO],
  ARTWORK: [...STILLS, ...VIDEO, 'application/pdf'],
  // The only kind that takes SVG, and the only one no grant can write to.
  BRAND: [...STILLS, 'application/pdf', 'image/svg+xml', 'font/woff2', 'font/otf'],
  OTHER: [...DOCS, ...WORD, ...STILLS],
}

/** Kinds an outside party may write through an access grant. */
export const GRANTABLE_KINDS: readonly FileKindKey[] = [
  'RIDER_HOSPITALITY',
  'RIDER_TECH',
  'STAGE_PLOT',
  'TECH_SPEC',
  'PRESS_SHOT',
  'BIO',
  'EPK',
]

/** The last extension, lowercased, or '' when there is not a plausible one. */
export function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? ''
  const dot = base.lastIndexOf('.')

  // A leading dot is a dotfile, not an extension.
  if (dot <= 0) return ''

  const ext = base.slice(dot).toLowerCase()
  // Long enough to be a sentence rather than an extension.
  if (ext.length > 12) return ''
  if (!/^\.[a-z0-9]+$/.test(ext)) return ''
  return ext
}

/**
 * Where the bytes live in the bucket.
 *
 * `kind/owner/<random><ext>` — the prefix is ours, the random part is 16
 * bytes from the CSPRNG, and the only thing taken from the uploader is a
 * validated extension. Nothing here is guessable and nothing is reused, so
 * an upload can never land on top of an existing object.
 */
export function objectKey(kind: FileKindKey, ownerId: string, filename: string): string {
  const prefix = kind.toLowerCase().replace(/_/g, '-')
  const owner = ownerId.replace(/[^A-Za-z0-9_-]/g, '')
  const id = randomBytes(16).toString('hex')
  return `${prefix}/${owner}/${id}${extensionOf(filename)}`
}

function bareMime(mime: string): string {
  return mime.split(';')[0]!.trim().toLowerCase()
}

export function isAllowedMime(kind: FileKindKey, mime: string): boolean {
  const accepted = ACCEPTS[kind]
  if (!accepted) return false
  return accepted.includes(bareMime(mime))
}

export function isWithinSize(kind: FileKindKey, bytes: number): boolean {
  if (!Number.isFinite(bytes) || bytes <= 0) return false
  return bytes <= MAX_BYTES[kind]
}

/**
 * The name shown in the interface.
 *
 * Kept as close to what the uploader called it as is safe — they named it
 * that so the tech would recognise it. Path components go, because browsers
 * sometimes send them and they are not part of a name; control characters go,
 * because this ends up in a Content-Disposition header.
 */
export function displayName(filename: string): string {
  const base = (filename.split(/[/\\]/).pop() ?? '')
    // \p{Cc} is the Unicode control category — the CR and LF that would let
    // a filename forge a second header, and everything else unprintable.
    .replace(/\p{Cc}/gu, '')
    .trim()

  if (!base) return 'Untitled'
  return base.length > 200 ? base.slice(0, 200) : base
}

/** A human explanation of why an upload will not be accepted, or null. */
export function rejectionFor(kind: FileKindKey, mime: string, bytes: number): string | null {
  if (!isAllowedMime(kind, mime)) {
    const accepted = ACCEPTS[kind] ?? []
    const list = accepted
      .map((m) => m.split('/')[1]?.toUpperCase())
      .filter((x, i, a) => x && a.indexOf(x) === i)
      .slice(0, 4)
      .join(', ')
    return `That file type is not accepted here. This slot takes ${list || 'nothing'}.`
  }

  if (!isWithinSize(kind, bytes)) {
    const limit = Math.round(MAX_BYTES[kind] / MB)
    return `That file is too large — the limit here is ${limit}MB.`
  }

  return null
}
