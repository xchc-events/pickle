import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

/**
 * How a password is kept.
 *
 * Never the password: a salted scrypt hash, written as a PHC-style string
 * that records its own parameters —
 *
 *     $scrypt$ln=15,r=8,p=3$<salt>$<hash>
 *
 * — so the cost can be raised later and every existing hash still checks,
 * then gets quietly upgraded the next time its owner signs in (`needsRehash`).
 *
 * ## Why scrypt and not Argon2id
 *
 * Argon2id is the first choice in OWASP's password storage guidance and
 * scrypt the second. The difference that decided it: Argon2id needs a native
 * dependency on the Node 22 this project runs on, and scrypt is in
 * `node:crypto`. This repository is public and has already turned down one
 * dependency over an advisory (see src/lib/email.ts), so the password path
 * takes nothing from npm at all. When the project moves to a Node with
 * `crypto.argon2`, the prefix above is what lets the two coexist.
 *
 * Pure apart from the CSPRNG, and free of `server-only`, so it can be tested
 * directly — the same reason `secrets.ts` and `grants.ts` are.
 */

export interface ScryptParams {
  /** log2 of N, the CPU and memory cost. */
  ln: number
  /** Block size. */
  r: number
  /** Parallelism — run sequentially by Node, so this multiplies time, not memory. */
  p: number
}

/**
 * N=2^15, r=8, p=3: one of OWASP's listed equivalents to 2^17/r8/p1.
 *
 * Chosen over 2^17 for memory. Each check holds about 32 MiB rather than
 * 128 MiB, and Node runs four at once on its thread pool — a burst of sign-in
 * attempts costs the server 128 MiB rather than half a gigabyte. It takes
 * about a fifth of a second on a laptop, which a person signing in does not
 * notice and somebody guessing does.
 */
export const PASSWORD_PARAMS: ScryptParams = { ln: 15, r: 8, p: 3 }

const SALT_BYTES = 16
const KEY_BYTES = 32

/**
 * The range a stored hash is allowed to ask for.
 *
 * The parameters come out of the database, and a value there must not be able
 * to size an allocation: `ln=30` would ask for well over a hundred gigabytes
 * on every attempt. Anything outside what this file would plausibly have
 * written is treated as not being one of its hashes.
 */
const BOUNDS = { ln: [10, 20], r: [1, 32], p: [1, 16] } as const

function derive(password: string, salt: Buffer, { ln, r, p }: ScryptParams): Promise<Buffer> {
  const N = 2 ** ln
  // scrypt needs roughly 128·N·r bytes; Node refuses anything over `maxmem`,
  // which defaults to 32 MiB — exactly the size this would need, less the
  // bookkeeping. Twice the requirement leaves room without removing the cap.
  const options: ScryptOptions = { N, r, p, maxmem: 256 * N * r }

  return new Promise((resolve, reject) => {
    // NFKC, so the same characters typed on a phone and on a laptop are the
    // same password. NIST 800-63B asks for exactly this.
    scrypt(password.normalize('NFKC'), salt, KEY_BYTES, options, (err, key) =>
      err ? reject(err) : resolve(key),
    )
  })
}

// base64 without padding, as PHC strings are written.
const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '')

export async function hashPassword(
  password: string,
  params: ScryptParams = PASSWORD_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(password, salt, params)
  return `$scrypt$ln=${params.ln},r=${params.r},p=${params.p}$${b64(salt)}$${b64(key)}`
}

interface Parsed {
  params: ScryptParams
  salt: Buffer
  key: Buffer
}

const SHAPE = /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/

function parse(stored: string): Parsed {
  const m = SHAPE.exec(stored)
  if (!m) throw new Error('Stored password is not a hash this product wrote.')

  const params = { ln: Number(m[1]), r: Number(m[2]), p: Number(m[3]) }
  for (const k of ['ln', 'r', 'p'] as const) {
    const [lo, hi] = BOUNDS[k]
    if (params[k] < lo || params[k] > hi) {
      throw new Error(`Stored password hash asks for ${k}=${params[k]}, outside ${lo}–${hi}.`)
    }
  }

  const salt = Buffer.from(m[4], 'base64')
  const key = Buffer.from(m[5], 'base64')
  if (key.length !== KEY_BYTES || salt.length < SALT_BYTES) {
    throw new Error('Stored password hash is the wrong length to be one of ours.')
  }

  return { params, salt, key }
}

/**
 * Whether this is the password the hash was made from.
 *
 * Throws, rather than answering false, when `stored` is not a hash — see the
 * test. A wrong password is an ordinary event; an unreadable hash is a fault.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const { params, salt, key } = parse(stored)
  const candidate = await derive(password, salt, params)
  return timingSafeEqual(candidate, key)
}

/**
 * Whether a hash was made more cheaply than the house now asks for.
 *
 * Checked after a successful sign-in, which is the only moment the password is
 * in hand to hash again. A hash stronger than current is left alone.
 */
export function needsRehash(stored: string, params: ScryptParams = PASSWORD_PARAMS): boolean {
  const current = parse(stored).params
  return current.ln < params.ln || current.r < params.r || current.p < params.p
}

/**
 * The work of a real check, against no account at all.
 *
 * Used when an address has no account, or no password: without it, those
 * refusals come back a fifth of a second faster than a wrong password on a real
 * account, and the response time says which addresses are on file.
 */
export async function verifyAgainstNothing(
  password: string,
  params: ScryptParams = PASSWORD_PARAMS,
): Promise<false> {
  await derive(password, randomBytes(SALT_BYTES), params)
  return false
}
