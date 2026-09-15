/**
 * A small, read-only client for the Epos Now V4 API.
 *
 * Epos Now is the venue's till. This product reads from it and never writes:
 * orders, stocktakes and the Xero posting of bar sales all happen in Epos Now
 * itself. So the client only ever GETs.
 *
 * What it does:
 *  - HTTP Basic, over the API device's key and secret — Epos Now's only scheme.
 *  - Pages at 200, which is Epos Now's fixed page size.
 *  - Backs off when Epos Now says it is busy. It publishes no numeric rate
 *    limit, so the client honours `Retry-After` and otherwise waits a little
 *    longer each time.
 *  - Keeps the key and the secret out of every error message. Errors get
 *    logged, toasted and pasted into issues; credentials must not ride along.
 *
 * `fetch` and `sleep` are arguments so every one of those behaviours is tested
 * without a network. The configured instance lives in src/lib/eposnow.ts.
 */

export const PAGE_SIZE = 200
/** 10,000 rows. Past this something is wrong with the query, not the venue. */
export const MAX_PAGES = 50

const DEFAULT_BASE = 'https://api.eposnowhq.com'
const RETRY_STATUSES = new Set([429, 502, 503, 504])
const MAX_WAIT_MS = 30_000

export class EposError extends Error {
  constructor(
    message: string,
    /** The HTTP status Epos Now answered with, or null when it was not reached. */
    readonly status: number | null,
    readonly path: string,
  ) {
    super(message)
    this.name = 'EposError'
  }
}

export type Query = Record<string, string | number | boolean | undefined>

export interface EposClient {
  get<T>(path: string, query?: Query): Promise<T>
  /** Every page of a list endpoint. Most take `page`; a few take `pageNumber`. */
  getAll<T>(path: string, query?: Query, pageParam?: 'page' | 'pageNumber'): Promise<T[]>
}

export interface EposClientOptions {
  key: string
  secret: string
  baseUrl?: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Retries after the first attempt, on a busy answer. */
  maxRetries?: number
  timeoutMs?: number
}

/** `Basic base64(key:secret)` — how Epos Now wants an API device to identify itself. */
export const authHeader = (key: string, secret: string): string =>
  `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`

export function createEposClient(o: EposClientOptions): EposClient {
  const base = (o.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '')
  const doFetch = o.fetch ?? fetch
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const maxRetries = o.maxRetries ?? 3
  const timeoutMs = o.timeoutMs ?? 20_000
  const auth = authHeader(o.key, o.secret)

  // Anything that could carry a credential is scrubbed before it reaches a
  // message — including an echo of the header from a misbehaving proxy.
  const secrets = [o.key, o.secret, auth.slice('Basic '.length)].filter((s) => s.length >= 4)
  const scrub = (text: string) =>
    secrets.reduce((t, s) => t.split(s).join('[redacted]'), text).slice(0, 200)

  const urlFor = (path: string, query: Query = {}) => {
    const url = new URL(`${base}/api/v4/${path.replace(/^\/+/, '')}`)
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
    return url.toString()
  }

  const waitFor = (res: Response, attempt: number) => {
    const header = Number(res.headers.get('retry-after'))
    const ms = Number.isFinite(header) && header > 0 ? header * 1000 : 1000 * 2 ** attempt
    return Math.min(ms, MAX_WAIT_MS)
  }

  async function get<T>(path: string, query?: Query): Promise<T> {
    const url = urlFor(path, query)

    for (let attempt = 0; ; attempt++) {
      let res: Response
      try {
        res = await doFetch(url, {
          method: 'GET',
          headers: {
            Authorization: auth,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err)
        throw new EposError(`Could not reach Epos Now: ${scrub(why)}`, null, path)
      }

      if (res.ok) return (await res.json()) as T

      if (res.status === 401 || res.status === 403) {
        throw new EposError(
          'Epos Now refused these credentials. Check EPOSNOW_API_KEY and EPOSNOW_API_SECRET belong to an API device on the venue’s account.',
          res.status,
          path,
        )
      }

      if (RETRY_STATUSES.has(res.status)) {
        if (attempt < maxRetries) {
          await sleep(waitFor(res, attempt))
          continue
        }
        throw new EposError(
          `Epos Now kept saying it was busy (${res.status}). Nothing was read — try again in a minute.`,
          res.status,
          path,
        )
      }

      const body = scrub(await res.text().catch(() => ''))
      throw new EposError(
        `Epos Now answered ${res.status} for ${path}${body ? `: ${body}` : ''}`,
        res.status,
        path,
      )
    }
  }

  async function getAll<T>(
    path: string,
    query: Query = {},
    pageParam: 'page' | 'pageNumber' = 'page',
  ): Promise<T[]> {
    const out: T[] = []

    for (let page = 1; page <= MAX_PAGES; page++) {
      const rows = await get<unknown>(path, { ...query, [pageParam]: page })
      if (!Array.isArray(rows)) {
        throw new EposError(
          `Epos Now sent something other than a list for ${path}, page ${page}.`,
          200,
          path,
        )
      }
      out.push(...(rows as T[]))
      if (rows.length < PAGE_SIZE) return out
    }

    throw new EposError(
      `${path} ran past ${MAX_PAGES} pages. Narrow the query rather than reading it all.`,
      200,
      path,
    )
  }

  return { get, getAll }
}
