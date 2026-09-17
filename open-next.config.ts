import { defineCloudflareConfig } from '@opennextjs/cloudflare'

/**
 * How @opennextjs/cloudflare packages this app for Workers.
 *
 * There is deliberately nothing in the config object. The only thing worth
 * configuring here is the incremental cache, and this app has nothing to put in
 * one: every page is `dynamic = 'force-dynamic'` because every page reads the
 * session, and there is no ISR, no `use cache` and no cached `fetch`. OpenNext's
 * own caching guide is explicit that a purely server-rendered route "will work
 * out of the box without any caching config", so adding an R2 or KV cache would
 * be a binding to maintain for a cache that is never written to.
 *
 * If a page is ever made static or revalidated, that is the moment to add an
 * `incrementalCache` here — not before.
 */
export default defineCloudflareConfig({})
