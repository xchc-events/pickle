import 'server-only'
import { createEposClient, type EposClient } from './eposnow-client'
import {
  tillRead,
  type EposCategory,
  type EposDevice,
  type EposProduct,
  type EposTransaction,
  type TillRead,
} from './eposnow-till'

/**
 * Epos Now, as configured on this install.
 *
 * Read-only. Epos Now is the till, the stock system, and what sends the day's
 * bar sales to Xero; this product reads the sales in a night's service window
 * and nothing else. See src/lib/eposnow-till.ts for what is done with them.
 *
 * Switched on by whether it is configured, like R2: without the keys, Bar still
 * works — a bar is closed by hand — and says Epos Now is not connected rather
 * than failing on a page that only happens to mention the till.
 */

interface EposConfig {
  key: string
  secret: string
  baseUrl?: string
  /** Only sales rung up on tills at this Epos Now location count, when set. */
  locationId: number | null
}

/** The variables, by name, so a smoke test can say exactly which is missing. */
export const EPOSNOW_VARS = ['EPOSNOW_API_KEY', 'EPOSNOW_API_SECRET'] as const

function config(): EposConfig | null {
  const key = process.env.EPOSNOW_API_KEY
  const secret = process.env.EPOSNOW_API_SECRET
  if (!key || !secret) return null

  const location = Number(process.env.EPOSNOW_LOCATION_ID)
  return {
    key,
    secret,
    baseUrl: process.env.EPOSNOW_BASE_URL || undefined,
    locationId: Number.isInteger(location) && location > 0 ? location : null,
  }
}

export function isConfigured(): boolean {
  return config() !== null
}

let cached: EposClient | null = null

export function eposnow(): EposClient {
  if (cached) return cached
  const c = config()
  if (!c) {
    throw new Error(
      'Epos Now is not configured. Set EPOSNOW_API_KEY and EPOSNOW_API_SECRET in .env — see README.',
    )
  }
  cached = createEposClient({ key: c.key, secret: c.secret, baseUrl: c.baseUrl })
  return cached
}

/**
 * The tills at the configured location, or null when every till counts.
 *
 * An Epos Now account can cover more than one site. Without this, a café on
 * the same account would have its sales read into the bar's night.
 */
async function venueDevices(client: EposClient): Promise<Set<number> | null> {
  const c = config()
  if (!c?.locationId) return null
  const devices = await client.getAll<EposDevice>(
    'Device',
    { devicesForAllLocations: true },
    'pageNumber',
  )
  return new Set(devices.filter((d) => d.LocationId === c.locationId).map((d) => d.Id))
}

/**
 * Everything the till recorded between two wall-clock times, as the bar half
 * of a night.
 *
 * `start` and `end` are the venue's clock — see `tillWindow` in bar.ts.
 */
export async function readTill(window: { start: string; end: string }): Promise<TillRead> {
  const client = eposnow()

  const [transactions, products, categories, devices] = await Promise.all([
    client.getAll<EposTransaction>('Transaction/GetByDate', {
      startDate: window.start,
      endDate: window.end,
    }),
    client.getAll<EposProduct>('Product'),
    client.getAll<EposCategory>('Category'),
    venueDevices(client),
  ])

  return tillRead(transactions, products, categories, devices ? { devices } : {})
}
