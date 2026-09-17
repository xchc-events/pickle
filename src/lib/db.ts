import { PrismaPg } from '@prisma/adapter-pg'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { PrismaClient } from '@/generated/prisma/client'
import {
  type DbEnv,
  type HyperdriveBinding,
  connectionStringFor,
  detectRuntime,
  isPerRequest,
} from './db-runtime'

/**
 * The one way into the database.
 *
 * `db` looks and behaves exactly as it always has — `db.user.findFirst(...)`,
 * `db.$transaction([...])` — but it is now a stand-in that fetches the right
 * client at the moment it is used, because "the right client" depends on where
 * the app is running and, on Cloudflare, on which request is being served.
 * src/lib/db-runtime.ts holds that decision and its tests.
 *
 * Two things changed here and both are deliberate:
 *
 *  - **Nothing is built at import time.** Importing this file used to throw if
 *    DATABASE_URL was unset, which is why CI's build job has to invent a dummy
 *    one. A build should not need a database. The error still exists, word for
 *    word, but it is now raised by the first query rather than by the import.
 *  - **On Workers a client belongs to one request.** Cloudflare refuses to let
 *    a socket opened while serving one request be used while serving another,
 *    so the client is cached against the request's execution context and no
 *    further. It is deliberately never disconnected: `after()` callbacks in
 *    src/lib/auth.ts write to the database once the response has already been
 *    sent, and ending the pool with the response would break them. The context
 *    is unreachable once the request is finished, so the WeakMap entry and the
 *    client go with it.
 */

// The one binding this app adds to the adapter's own list. Declared here rather
// than taken from a generated cloudflare-env.d.ts so that a checkout typechecks
// without anyone having run `npm run cf:typegen` first.
declare global {
  interface CloudflareEnv {
    HYPERDRIVE?: HyperdriveBinding
  }
}

const runtime = detectRuntime(globalThis)

function createClient(env: DbEnv) {
  const connectionString = connectionStringFor(runtime, env)
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

// Next dev reloads modules on every edit; without the global cache we would
// open a new pool per reload and exhaust Postgres connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

let processClient: PrismaClient | undefined

/** One client for this Node process, as it has always been. */
function forProcess(): PrismaClient {
  processClient ??=
    globalForPrisma.prisma ?? createClient({ DATABASE_URL: process.env.DATABASE_URL })
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = processClient
  return processClient
}

// Keyed on the request's execution context, which workerd hands the Worker once
// per request and keeps alive for as long as anything the request scheduled —
// an `after()` write included — is still running.
const requestClients = new WeakMap<object, PrismaClient>()

/** One client for the request currently being served on Cloudflare. */
function forRequest(): PrismaClient {
  const { env, ctx } = getCloudflareContext()
  const existing = requestClients.get(ctx)
  if (existing) return existing

  const client = createClient(env)
  requestClients.set(ctx, client)
  return client
}

function currentClient(): PrismaClient {
  return isPerRequest(runtime) ? forRequest() : forProcess()
}

// A Proxy rather than a getter per model, so that anything Prisma exposes keeps
// working without being listed here. Methods are bound to the real client, so
// `db.$transaction` behaves the same whether it is called off `db` or pulled
// off it first.
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_standIn, property) {
    const client = currentClient()
    const value = Reflect.get(client, property, client)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
