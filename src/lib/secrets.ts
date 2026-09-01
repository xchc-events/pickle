import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Sealing for payment details.
 *
 * Bank accounts and IRD numbers are the only fields in this product that are
 * encrypted at rest. Everything else about an event is operational data the
 * venue looks at all day; these two are not, and a database backup that ends
 * up somewhere it should not must not carry them in the clear.
 *
 * AES-256-GCM, so a tampered payload fails to open rather than opening to
 * something else. The key never appears in the schema, the repository or the
 * activity log — it comes from PAYMENT_KEY and nowhere else.
 *
 * Kept free of `server-only` so it can be tested directly, the same reason
 * `scope.ts` is. It is never imported from a client component; the reveal
 * path in `payments.ts` is what enforces that.
 */

/** Bumped if the payload layout ever changes. Byte 0 of every sealed value. */
export const SEAL_VERSION = 1

const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

function key(): Buffer {
  const raw = process.env.PAYMENT_KEY
  if (!raw) {
    throw new Error(
      'PAYMENT_KEY is not set. Generate one with `openssl rand -base64 32` and put it in .env — ' +
        'payment details cannot be read or written without it.',
    )
  }

  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `PAYMENT_KEY must decode to 32 bytes, got ${buf.length}. Generate one with \`openssl rand -base64 32\`.`,
    )
  }
  return buf
}

/**
 * Whether a usable key is present.
 *
 * Checked by callers that have somebody waiting on the other end. An artist
 * filling in a form should not meet a stack trace because the venue has not
 * finished configuring the install — they get told it is not ready, and the
 * venue gets the loud error in its own logs.
 */
export function isConfigured(): boolean {
  try {
    key()
    return true
  } catch {
    return false
  }
}

/**
 * Seal a value.
 *
 * Layout: version(1) ‖ iv(12) ‖ ciphertext(n) ‖ tag(16). The IV is random per
 * call — reusing one under the same key would leak the plaintext, which is
 * why `seal` takes no IV argument and there is no deterministic variant.
 */
export function seal(plaintext: string): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from([SEAL_VERSION]), iv, body, cipher.getAuthTag()])
}

/**
 * Open a sealed value.
 *
 * Throws rather than returning null: a payment detail that cannot be
 * decrypted is not an empty payment detail, and a caller that treats it as
 * one would pay nobody and say nothing.
 */
export function open(sealed: Buffer): string {
  if (sealed.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new Error('Sealed payload is too short to be one.')
  }

  const version = sealed[0]
  if (version !== SEAL_VERSION) {
    throw new Error(`Unknown seal version ${version} — this value was written by another build.`)
  }

  const iv = sealed.subarray(1, 1 + IV_BYTES)
  const body = sealed.subarray(1 + IV_BYTES, sealed.length - TAG_BYTES)
  const tag = sealed.subarray(sealed.length - TAG_BYTES)

  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)

  try {
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    // GCM's own error text names the cipher and helps nobody. What a caller
    // needs to know is that this did not come from us under this key.
    throw new Error(
      'Payment detail failed to authenticate — it was sealed under a different key, or it has been altered.',
    )
  }
}

/** Whether a value looks like something `seal` produced. Shape only. */
export function isSealed(value: Buffer | null | undefined): boolean {
  if (!value || !Buffer.isBuffer(value)) return false
  return value.length >= 1 + IV_BYTES + TAG_BYTES && value[0] === SEAL_VERSION
}

/**
 * A short, stable identifier for the key currently in use.
 *
 * Written to the activity log alongside every reveal, so that if the key is
 * ever rotated it is possible to tell which values were read under which key
 * without the key itself ever being recorded.
 */
export function keyFingerprint(): string {
  return createHash('sha256').update(key()).digest('hex').slice(0, 8)
}
