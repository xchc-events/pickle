/**
 * R2 smoke test: proves the credentials in .env actually reach the bucket.
 *
 * This is not a unit test and is deliberately outside `src/**\/*.test.ts`, so
 * `npm run check` never runs it — it needs real credentials and a network,
 * and CI has neither. It exists for the one moment it is useful: the first
 * time somebody fills in R2_* and wants to know whether they got it right
 * before wondering why an upload page is misbehaving.
 *
 * It exercises `src/lib/r2.ts` itself rather than a copy of it, so the
 * endpoint formula and the signing options under test are the ones the app
 * really uses. That is also why it has to be run with the `react-server`
 * condition — `r2.ts` imports `server-only`, which throws everywhere else:
 *
 *     npm run r2:smoke
 *
 * The object it writes is a few bytes under a `smoke-test/` prefix and is
 * deleted again in `finally`, including when a step fails part way.
 */

import 'dotenv/config'
import { downloadUrl, isConfigured, remove, uploadUrl, verify } from '../src/lib/r2'

const KEY = `smoke-test/${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}.txt`
const BODY = `pickle r2 smoke test ${new Date().toISOString()}\n`
const MIME = 'text/plain'
const FILENAME = 'smoke-test.txt'

let failures = 0
let step = 0

function pass(name: string, detail = ''): void {
  console.log(`  \x1b[32mPASS\x1b[0m  ${name}${detail ? ` — ${detail}` : ''}`)
}

function fail(name: string, detail: string): void {
  failures++
  console.log(`  \x1b[31mFAIL\x1b[0m  ${name} — ${detail}`)
}

async function check(name: string, fn: () => Promise<string | void>): Promise<boolean> {
  step++
  try {
    const detail = await fn()
    pass(`${step}. ${name}`, detail ?? '')
    return true
  } catch (err) {
    fail(`${step}. ${name}`, err instanceof Error ? err.message : String(err))
    return false
  }
}

/**
 * Which variables are missing, by name.
 *
 * Named rather than counted because "R2 is not configured" sends you back to
 * re-read all four; "R2_SECRET_ACCESS_KEY is missing" does not. Values are
 * never printed — one of these is a secret and this output gets pasted into
 * chats and issues.
 */
function missingVars(): string[] {
  return ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].filter(
    (name) => !process.env[name],
  )
}

async function main(): Promise<void> {
  console.log('\nR2 smoke test\n')

  const missing = missingVars()
  if (missing.length > 0) {
    console.log(`  \x1b[31mFAIL\x1b[0m  not configured — missing from .env: ${missing.join(', ')}`)
    console.log('\n  Nothing else can run until those are set.\n')
    process.exit(1)
  }

  if (!isConfigured()) {
    console.log(
      '  \x1b[31mFAIL\x1b[0m  isConfigured() is false despite all four variables being set',
    )
    process.exit(1)
  }

  console.log(`  bucket    ${process.env.R2_BUCKET}`)
  console.log(`  endpoint  https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`)
  console.log(`  key       ${KEY}\n`)

  let uploaded = false

  try {
    // The browser never sends credentials — it PUTs to a signed URL. Testing
    // it that way means a signature that only works with headers attached
    // fails here rather than in front of somebody uploading a rider.
    uploaded = await check('presigned PUT accepted the object', async () => {
      const url = await uploadUrl(KEY, MIME)
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': MIME },
        body: BODY,
      })
      if (!res.ok) throw new Error(`R2 answered ${res.status} ${res.statusText}`)
      return `${Buffer.byteLength(BODY)} bytes`
    })

    if (uploaded) {
      await check('HEAD reports the object we actually sent', async () => {
        const found = await verify(KEY)
        if (!found) throw new Error('verify() returned null — the object is not there')
        const expected = Buffer.byteLength(BODY)
        if (found.size !== expected) {
          throw new Error(`size is ${found.size}, expected ${expected}`)
        }
        if (found.mime !== MIME) throw new Error(`mime is ${found.mime}, expected ${MIME}`)
        return `${found.size} bytes, ${found.mime}`
      })

      await check('presigned GET returns the same bytes', async () => {
        const url = await downloadUrl(KEY, FILENAME, MIME)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`R2 answered ${res.status} ${res.statusText}`)
        const text = await res.text()
        if (text !== BODY) throw new Error('the bytes read back differ from the bytes written')
        return `${Buffer.byteLength(text)} bytes`
      })

      // Not a detail: an SVG or HTML file served inline would run its own
      // script against this origin. r2.ts forces attachment, and that is
      // worth proving against the real service rather than trusting it.
      await check('GET forces a download rather than inline render', async () => {
        const url = await downloadUrl(KEY, FILENAME, MIME)
        const res = await fetch(url)
        const disposition = res.headers.get('content-disposition') ?? ''
        if (!disposition.toLowerCase().startsWith('attachment')) {
          throw new Error(`content-disposition is "${disposition}", expected attachment`)
        }
        return disposition
      })
    }

    await check('DELETE removes the object', async () => {
      await remove(KEY)
      uploaded = false
      const found = await verify(KEY)
      if (found) throw new Error('the object is still there after remove()')
      return 'gone'
    })
  } finally {
    // Belt and braces: if a step above threw before the delete ran, do not
    // leave the bucket holding test objects.
    if (uploaded) {
      try {
        await remove(KEY)
        console.log(`\n  cleaned up ${KEY}`)
      } catch {
        console.log(`\n  \x1b[33mWARN\x1b[0m  could not clean up ${KEY} — delete it by hand`)
      }
    }
  }

  if (failures > 0) {
    console.log(`\n\x1b[31m${failures} of ${step} checks failed.\x1b[0m R2 is not usable yet.\n`)
    process.exit(1)
  }

  console.log(`\n\x1b[32mAll ${step} checks passed.\x1b[0m R2 is configured correctly.\n`)
}

main().catch((err) => {
  console.error('\n\x1b[31mThe smoke test could not run.\x1b[0m\n')
  console.error(err instanceof Error ? err.message : err)
  console.error()
  process.exit(1)
})
