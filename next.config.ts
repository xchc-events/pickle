import type { NextConfig } from 'next'

// `npm run cf:build` sets this; an ordinary `next build` or `next dev` does not.
const forWorkers = process.env.PRISMA_CLIENT_TARGET === 'workerd'

const nextConfig: NextConfig = {
  // `pg` reaches Postgres through `pg-cloudflare` when it runs on Workers —
  // that package is where the `cloudflare:sockets` TCP connection lives. Its
  // package exports hand Node an empty stub and workerd the real thing, and
  // Next traces the build with Node's conditions, so only the stub is copied
  // into the build output. The Cloudflare adapter then bundles that output with
  // workerd's conditions, asks for the real file, and the build stops with
  // `Could not resolve "pg-cloudflare"`. Tracing the whole package in is the
  // documented way out; it costs about 20 kB and is harmless under Node, where
  // the stub is still the one that gets loaded.
  outputFileTracingIncludes: {
    '/*': ['./node_modules/pg-cloudflare/**/*'],
  },

  // Build-time tooling gets dragged into the trace because the app imports
  // `@prisma/client` and `@opennextjs/cloudflare`, and that tooling is full of
  // WebAssembly: the Prisma CLI ships a query compiler and a schema engine for
  // every database Prisma supports, `@prisma/dev` ships an entire Postgres
  // (pglite), and wrangler ships workerd. The Cloudflare adapter turns every
  // traced .wasm into a module the Worker uploads and compiles at startup, so
  // leaving them in cost about 38 MB of engines for databases this app does not
  // use — it more than doubled the upload. None of it runs on the Worker:
  // migrations and the seed are run by the deploy workflow on a Node runner,
  // and `initOpenNextCloudflareForDev` — the only thing that reaches for
  // wrangler at runtime — is never called.
  outputFileTracingExcludes: {
    '/*': [
      './node_modules/prisma/**',
      './node_modules/@prisma/dev/**',
      './node_modules/wrangler/**',
      './node_modules/miniflare/**',
      './node_modules/workerd/**',
      './node_modules/@electric-sql/**',
    ],
  },

  // Prisma 7 compiles queries with a WebAssembly module, and the two runtimes
  // load it in ways that cannot be reconciled in one generated client: Node
  // decodes it from base64 into `new WebAssembly.Module(...)`, which workerd
  // refuses outright ("Wasm code generation disallowed by embedder"), while
  // workerd imports it as a module, which means nothing to Node. So the schema
  // generates both (see prisma/schema.prisma) and the Cloudflare build swaps
  // one for the other here. Everything else — the models, the types, every call
  // site — is identical between them.
  ...(forWorkers
    ? {
        turbopack: {
          resolveAlias: {
            '@/generated/prisma/client': './src/generated/prisma-workerd/client.ts',
          },
        },
      }
    : {}),
}

// Note that `initOpenNextCloudflareForDev` is deliberately not called here. It
// would point `next dev` at wrangler's bindings, and `next dev` is meant to
// keep connecting straight to Postgres through DATABASE_URL as it always has.

export default nextConfig
