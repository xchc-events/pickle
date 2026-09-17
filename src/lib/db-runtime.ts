/**
 * Which database this process should connect to, and how long it may hold on.
 *
 * The app runs in two places now. On a laptop, in CI, in vitest and in the
 * seed it is an ordinary Node process talking to Postgres over DATABASE_URL,
 * and one pooled client lasts as long as the process. On Cloudflare Workers
 * there is no DATABASE_URL and no long-lived process: the connection string
 * comes off the HYPERDRIVE binding, and a client may only live for the request
 * that built it, because a socket opened while serving one request cannot be
 * used while serving another — Cloudflare fails that with "Cannot perform I/O
 * on behalf of a different request".
 *
 * All of that judgement lives here rather than in src/lib/db.ts so it can be
 * tested. db.ts opens a connection pool the moment it is asked for a client,
 * which makes it the wrong place to keep a decision in.
 */

/** A Cloudflare Hyperdrive binding, as far as this app uses one. */
export interface HyperdriveBinding {
  readonly connectionString: string
}

/** The two places this app runs. */
export type DbRuntime = 'node' | 'workers'

/** Everything either runtime might offer us to connect with. */
export interface DbEnv {
  readonly DATABASE_URL?: string | undefined
  readonly HYPERDRIVE?: HyperdriveBinding | undefined
}

/** What a developer sees when the app has no database configured locally. */
export const MISSING_DATABASE_URL = 'DATABASE_URL is not set — copy .env.example to .env'

/** What the logs say when a deployed Worker has no database bound to it. */
export const MISSING_HYPERDRIVE =
  'The HYPERDRIVE binding is missing or empty — this Worker has no database. ' +
  'Check the hyperdrive block in wrangler.jsonc, and that the deploy replaced ' +
  'HYPERDRIVE_ID_PLACEHOLDER with the real Hyperdrive id.'

/**
 * Whether we are running on Cloudflare Workers.
 *
 * Workers set `navigator.userAgent` to exactly `Cloudflare-Workers`, and that
 * exact string is the test. Node has had a `navigator` of its own since 21, so
 * merely having one proves nothing; browsers have one too. Takes the globals to
 * look at as an argument so the test can hand it each of those in turn.
 */
export function detectRuntime(globals: { navigator?: { userAgent?: string } }): DbRuntime {
  return globals.navigator?.userAgent === 'Cloudflare-Workers' ? 'workers' : 'node'
}

/**
 * Whether a client built for this runtime may be reused by a later request.
 *
 * On Workers it may not, and Hyperdrive is what makes that affordable: it holds
 * the real pool on Cloudflare's side, so opening a connection per request is
 * cheap rather than ruinous.
 */
export function isPerRequest(runtime: DbRuntime): boolean {
  return runtime === 'workers'
}

/**
 * The connection string to build a client from, or a refusal saying why not.
 *
 * Note that the Worker branch never falls back to DATABASE_URL. If one were
 * ever left in the Worker's vars, falling back would open a direct connection
 * from the edge to Postgres — the exact thing Hyperdrive is there to prevent —
 * and it would work well enough to go unnoticed. Failing is the safer answer.
 */
export function connectionStringFor(runtime: DbRuntime, env: DbEnv): string {
  if (runtime === 'workers') {
    const connectionString = env.HYPERDRIVE?.connectionString
    if (!connectionString) throw new Error(MISSING_HYPERDRIVE)
    return connectionString
  }

  const connectionString = env.DATABASE_URL
  if (!connectionString) throw new Error(MISSING_DATABASE_URL)
  return connectionString
}
