import { describe, expect, it } from 'vitest'
import {
  MISSING_DATABASE_URL,
  MISSING_HYPERDRIVE,
  connectionStringFor,
  detectRuntime,
  isPerRequest,
} from './db-runtime'

/**
 * Where the database lives, and how long a connection to it may be kept.
 *
 * Written before the implementation because getting it wrong has two failure
 * modes that are both invisible until the site is live. Pick the wrong
 * connection string and the deployed Worker talks to nothing, or worse, to a
 * developer's laptop database. Keep a client for longer than a request and
 * Cloudflare kills the second request with "Cannot perform I/O on behalf of a
 * different request" — a socket opened while serving one request cannot be used
 * while serving another.
 *
 * The decision is pulled out of src/lib/db.ts and put here on its own because
 * db.ts itself cannot be tested: importing it opens a Postgres pool. This
 * module is the part with the judgement in it, so this is the part with tests.
 */

describe('detectRuntime', () => {
  it('reports workers when the global navigator says Cloudflare-Workers', () => {
    expect(detectRuntime({ navigator: { userAgent: 'Cloudflare-Workers' } })).toBe('workers')
  })

  it('reports node when there is no navigator at all', () => {
    // Older Node, and any bare script or test runner that does not define one.
    expect(detectRuntime({})).toBe('node')
  })

  it('reports node for the navigator Node itself defines', () => {
    // Node 21+ has globalThis.navigator, so the check has to be the exact
    // user agent string and not merely the presence of a navigator.
    expect(detectRuntime({ navigator: { userAgent: 'Node.js/26.0.0' } })).toBe('node')
  })

  it('reports node for a browser-shaped user agent', () => {
    expect(detectRuntime({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh)' } })).toBe('node')
  })

  it('reports node when navigator exists but carries no user agent', () => {
    expect(detectRuntime({ navigator: {} })).toBe('node')
  })
})

describe('isPerRequest', () => {
  it('builds a client per request on workers', () => {
    expect(isPerRequest('workers')).toBe(true)
  })

  it('keeps one client for the whole process on node', () => {
    // A dev server, CI, vitest and the seed all want the single pooled client
    // they have always had; opening one per request would exhaust Postgres.
    expect(isPerRequest('node')).toBe(false)
  })
})

describe('connectionStringFor, on node', () => {
  it('uses DATABASE_URL', () => {
    expect(connectionStringFor('node', { DATABASE_URL: 'postgresql://pickle@host/pickle' })).toBe(
      'postgresql://pickle@host/pickle',
    )
  })

  it('refuses with the copy-the-example message when DATABASE_URL is unset', () => {
    expect(() => connectionStringFor('node', {})).toThrow(MISSING_DATABASE_URL)
  })

  it('treats a blank DATABASE_URL as unset', () => {
    // CI's build job sets a dummy URL precisely so that nothing trips over an
    // empty one; a blank string is a misconfiguration, not a connection.
    expect(() => connectionStringFor('node', { DATABASE_URL: '' })).toThrow(MISSING_DATABASE_URL)
  })

  it('ignores a Hyperdrive binding if one is somehow present', () => {
    expect(
      connectionStringFor('node', {
        DATABASE_URL: 'postgresql://local/pickle',
        HYPERDRIVE: { connectionString: 'postgresql://hyperdrive/pickle' },
      }),
    ).toBe('postgresql://local/pickle')
  })
})

describe('connectionStringFor, on workers', () => {
  it('uses the HYPERDRIVE binding', () => {
    expect(
      connectionStringFor('workers', {
        HYPERDRIVE: { connectionString: 'postgresql://hyperdrive/pickle' },
      }),
    ).toBe('postgresql://hyperdrive/pickle')
  })

  it('never falls back to DATABASE_URL', () => {
    // A DATABASE_URL left in the Worker's vars would be a direct connection
    // from the edge, which is the thing Hyperdrive exists to prevent. Failing
    // loudly is better than quietly connecting the wrong way.
    expect(() =>
      connectionStringFor('workers', { DATABASE_URL: 'postgresql://someone-elses-db/pickle' }),
    ).toThrow(MISSING_HYPERDRIVE)
  })

  it('refuses when the binding is missing', () => {
    expect(() => connectionStringFor('workers', {})).toThrow(MISSING_HYPERDRIVE)
  })

  it('refuses when the binding is there but empty', () => {
    expect(() => connectionStringFor('workers', { HYPERDRIVE: { connectionString: '' } })).toThrow(
      MISSING_HYPERDRIVE,
    )
  })

  it('names the binding and the config file it comes from', () => {
    // Whoever hits this is looking at a 500 on a deployed site, so the message
    // has to say which binding and where it is configured.
    expect(MISSING_HYPERDRIVE).toContain('HYPERDRIVE')
    expect(MISSING_HYPERDRIVE).toContain('wrangler.jsonc')
  })
})
