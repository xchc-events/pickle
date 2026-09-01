import 'server-only'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/**
 * Cloudflare R2.
 *
 * The bytes never pass through this application. A browser uploading a 500MB
 * print PDF PUTs it straight to a presigned URL, and reads it back from a
 * presigned GET — so the Next server handles the *description* of a file and
 * never the file. That is what keeps a video cut from being a 100MB request
 * against a route handler.
 *
 * The rules about what may be uploaded live in `files.ts`, which is pure and
 * tested. This module is the I/O and nothing else.
 */

const PUT_TTL = 300 // 5 minutes to start an upload.
const GET_TTL = 900 // 15 minutes to read one back.

interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

function config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
  return { accountId, accessKeyId, secretAccessKey, bucket }
}

/**
 * Whether object storage is set up.
 *
 * Checked rather than assumed so that an install without R2 credentials
 * shows "file storage is not configured" and keeps working, instead of
 * throwing on a page that only happens to mention a file.
 */
export function isConfigured(): boolean {
  return config() !== null
}

function need(): R2Config {
  const c = config()
  if (!c) {
    throw new Error(
      'R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and ' +
        'R2_BUCKET in .env — see README.',
    )
  }
  return c
}

let cached: { client: S3Client; bucket: string } | null = null

function client(): { client: S3Client; bucket: string } {
  if (cached) return cached
  const c = need()

  cached = {
    bucket: c.bucket,
    client: new S3Client({
      // R2 is single-region and ignores this, but the SDK requires one.
      region: 'auto',
      endpoint: `https://${c.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    }),
  }
  return cached
}

/**
 * A URL the browser may PUT one object to.
 *
 * The signature pins the key and the content type. It does *not* pin the
 * length: R2 presigned PUTs cannot express a maximum, so an uploader who
 * ignores the browser-side check can send more bytes than they declared.
 * That is what `verify` below is for — the size limit is enforced after the
 * fact against what R2 actually received, not against what the browser said.
 */
export async function uploadUrl(key: string, mime: string): Promise<string> {
  const { client: s3, bucket } = client()
  return getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mime }), {
    expiresIn: PUT_TTL,
  })
}

/**
 * A URL to read one object back.
 *
 * Always `attachment`. An uploaded SVG or HTML file rendered inline would run
 * its own script; forcing a download means the browser never executes it, and
 * costs a reader nothing but a click. The filename is the one the uploader
 * chose, already stripped of path and control characters by `displayName`.
 */
export async function downloadUrl(key: string, filename: string, mime: string): Promise<string> {
  const { client: s3, bucket } = client()
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentType: mime,
      ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, '')}"`,
    }),
    { expiresIn: GET_TTL },
  )
}

export interface StoredObject {
  size: number
  mime: string
  etag: string
}

/**
 * What R2 actually holds at this key.
 *
 * The browser's claims about size and type are the uploader's claims. This is
 * the only account of them that is not.
 */
export async function verify(key: string): Promise<StoredObject | null> {
  const { client: s3, bucket } = client()

  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return {
      size: head.ContentLength ?? 0,
      mime: head.ContentType ?? 'application/octet-stream',
      etag: (head.ETag ?? '').replace(/"/g, ''),
    }
  } catch {
    // A missing object is a normal outcome — the upload may have been
    // abandoned — and not something to throw over.
    return null
  }
}

/** Remove an object. Used when an upload fails verification. */
export async function remove(key: string): Promise<void> {
  const { client: s3, bucket } = client()
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}
