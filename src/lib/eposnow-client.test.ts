import { describe, expect, it } from 'vitest'
import { EposError, PAGE_SIZE, authHeader, createEposClient } from './eposnow-client'

/**
 * The Epos Now client.
 *
 * Read-only, and deliberately small: Basic auth, JSON, paging and backing off
 * when Epos Now says it is busy. It takes `fetch` as an argument so all of that
 * is tested here without a network — and so a test can prove the API key
 * never ends up in an error message, which gets pasted into chats and issues.
 */

const KEY = 'test-key-not-real'
const SECRET = 'test-secret-not-real'

type Call = { url: string; init: RequestInit }

function fakeFetch(responses: (Response | Error)[]) {
  const calls: Call[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = responses.shift()
    if (!next) throw new Error('no more fake responses')
    if (next instanceof Error) throw next
    return next
  }) as typeof fetch
  return { fn, calls }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

const noSleep = async () => {}

const rows = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => ({ Id: offset + i }))

describe('authHeader', () => {
  it('is Basic, over the key and secret joined by a colon', () => {
    expect(authHeader('abc', 'xyz')).toBe(`Basic ${Buffer.from('abc:xyz').toString('base64')}`)
  })
})

describe('get', () => {
  it('asks v4 for JSON, with Basic auth', async () => {
    const { fn, calls } = fakeFetch([json({ CompanyName: 'XCHC' })])
    const client = createEposClient({ key: KEY, secret: SECRET, fetch: fn, sleep: noSleep })

    await client.get('TokenInfo')

    expect(calls[0]!.url).toBe('https://api.eposnowhq.com/api/v4/TokenInfo')
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get('authorization')).toBe(authHeader(KEY, SECRET))
    expect(headers.get('accept')).toBe('application/json')
  })

  it('puts the query on the URL and leaves out what is not set', async () => {
    const { fn, calls } = fakeFetch([json([])])
    const client = createEposClient({ key: KEY, secret: SECRET, fetch: fn, sleep: noSleep })

    await client.get('Transaction/GetByDate', {
      startDate: '2026-09-19T19:30:00',
      endDate: '2026-09-20T01:00:00',
      deviceId: undefined,
    })

    const url = new URL(calls[0]!.url)
    expect(url.pathname).toBe('/api/v4/Transaction/GetByDate')
    expect(url.searchParams.get('startDate')).toBe('2026-09-19T19:30:00')
    expect(url.searchParams.has('deviceId')).toBe(false)
  })

  it('names the credentials when Epos Now refuses them, without repeating them', async () => {
    const { fn } = fakeFetch([json({ Message: 'Invalid token' }, 401)])
    const client = createEposClient({ key: KEY, secret: SECRET, fetch: fn, sleep: noSleep })

    const err = await client.get('TokenInfo').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EposError)
    expect((err as EposError).status).toBe(401)
    expect((err as Error).message).toMatch(/EPOSNOW_API_KEY/)
  })

  it('waits and tries again when Epos Now says it is busy, as long as it asks', async () => {
    const waits: number[] = []
    const { fn, calls } = fakeFetch([json({}, 429, { 'retry-after': '2' }), json({ ok: true })])
    const client = createEposClient({
      key: KEY,
      secret: SECRET,
      fetch: fn,
      sleep: async (ms) => {
        waits.push(ms)
      },
    })

    expect(await client.get('TokenInfo')).toEqual({ ok: true })
    expect(calls).toHaveLength(2)
    expect(waits).toEqual([2000])
  })

  it('gives up after a few tries with a sentence, not a stack', async () => {
    const { fn, calls } = fakeFetch([json({}, 429), json({}, 429), json({}, 429), json({}, 429)])
    const client = createEposClient({ key: KEY, secret: SECRET, fetch: fn, sleep: noSleep })

    const err = await client.get('TokenInfo').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EposError)
    expect((err as Error).message).toMatch(/busy/i)
    expect(calls).toHaveLength(4)
  })

  it('says what Epos Now answered when it is something else', async () => {
    const { fn } = fakeFetch([new Response('Not found', { status: 404 })])
    const client = createEposClient({ key: KEY, secret: SECRET, fetch: fn, sleep: noSleep })

    const err = (await client.get('Nope').catch((e: unknown) => e)) as EposError
    expect(err.status).toBe(404)
    expect(err.message).toMatch(/404/)
  })

  it('wraps a failure to reach Epos Now at all', async () => {
    const { fn } = fakeFetch([new TypeError('fetch failed')])
    const client = createEposClient({ key: KEY, secret: SECRET, fetch: fn, sleep: noSleep })

    const err = (await client.get('TokenInfo').catch((e: unknown) => e)) as EposError
    expect(err).toBeInstanceOf(EposError)
    expect(err.status).toBeNull()
    expect(err.message).toMatch(/reach Epos Now/)
  })

  /**
   * An error message is the thing most likely to leave the building — logged,
   * toasted, pasted into an issue. None of them may carry the key, the secret,
   * or the header that encodes them.
   */
  it('never puts the key or secret in an error', async () => {
    const encoded = Buffer.from(`${KEY}:${SECRET}`).toString('base64')
    const failures = [
      json({ Message: `bad ${encoded}` }, 401),
      json({}, 500),
      new TypeError('fetch failed'),
      json({ echo: KEY }, 400),
    ]

    for (const failure of failures) {
      const { fn } = fakeFetch([failure])
      const client = createEposClient({ key: KEY, secret: SECRET, fetch: fn, sleep: noSleep })
      const err = (await client.get('TokenInfo').catch((e: unknown) => e)) as Error
      expect(err.message).not.toContain(KEY)
      expect(err.message).not.toContain(SECRET)
      expect(err.message).not.toContain(encoded)
    }
  })
})

describe('getAll', () => {
  it('reads every page until a short one', async () => {
    const { fn, calls } = fakeFetch([
      json(rows(PAGE_SIZE)),
      json(rows(PAGE_SIZE, PAGE_SIZE)),
      json(rows(3, PAGE_SIZE * 2)),
    ])
    const client = createEposClient({ key: KEY, secret: SECRET, fetch: fn, sleep: noSleep })

    const all = await client.getAll('Product')
    expect(all).toHaveLength(PAGE_SIZE * 2 + 3)
    expect(calls.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2', '3'])
  })

  it('stops at an empty first page', async () => {
    const { fn, calls } = fakeFetch([json([])])
    const client = createEposClient({ key: KEY, secret: SECRET, fetch: fn, sleep: noSleep })

    expect(await client.getAll('Product')).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('uses the page parameter the endpoint wants', async () => {
    const { fn, calls } = fakeFetch([json([])])
    const client = createEposClient({ key: KEY, secret: SECRET, fetch: fn, sleep: noSleep })

    await client.getAll('Device', { devicesForAllLocations: true }, 'pageNumber')
    const url = new URL(calls[0]!.url)
    expect(url.searchParams.get('pageNumber')).toBe('1')
    expect(url.searchParams.get('devicesForAllLocations')).toBe('true')
  })

  it('refuses a page that is not a list rather than guessing at its shape', async () => {
    const { fn } = fakeFetch([json({ Data: [] })])
    const client = createEposClient({ key: KEY, secret: SECRET, fetch: fn, sleep: noSleep })

    const err = (await client.getAll('Product').catch((e: unknown) => e)) as EposError
    expect(err).toBeInstanceOf(EposError)
    expect(err.message).toMatch(/list/i)
  })
})
