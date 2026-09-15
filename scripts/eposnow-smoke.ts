/**
 * Epos Now smoke test: proves the keys in .env reach the venue's account, and
 * shows the shapes the bar reads so they can be checked against the real till.
 *
 * Read-only. It never writes to Epos Now — nothing in this product does.
 *
 * Not a unit test, and deliberately outside `src/**\/*.test.ts`, so
 * `npm run check` never runs it: it needs real credentials and a network, and
 * CI has neither. The unit tests in src/lib/eposnow-*.test.ts are written
 * against Epos Now's published V4 spec; this is what checks that spec against
 * the account XCHC actually has.
 *
 * It exercises src/lib/eposnow.ts itself rather than a copy, which is why it
 * runs with the `react-server` condition — that module imports `server-only`:
 *
 *     npm run eposnow:smoke
 *
 * Two things to compare by eye afterwards, because no script can:
 *  - the take it reads for yesterday against Epos Now's own End of Day report;
 *  - the first sale's time against when the bar actually opened, which is how
 *    you find out whether Epos Now reads the window in NZ time as assumed.
 */

import 'dotenv/config'
import { EPOSNOW_VARS, eposnow, isConfigured, readTill } from '../src/lib/eposnow'
import type { EposCategory, EposDevice, EposProduct } from '../src/lib/eposnow-till'

let failures = 0
let step = 0

const pass = (name: string, detail = '') =>
  console.log(`  \x1b[32mPASS\x1b[0m  ${name}${detail ? ` — ${detail}` : ''}`)
const fail = (name: string, detail: string) => {
  failures++
  console.log(`  \x1b[31mFAIL\x1b[0m  ${name} — ${detail}`)
}
const warn = (detail: string) => console.log(`  \x1b[33mWARN\x1b[0m  ${detail}`)

async function check(name: string, fn: () => Promise<string | void>): Promise<boolean> {
  step++
  try {
    pass(`${step}. ${name}`, (await fn()) ?? '')
    return true
  } catch (err) {
    fail(`${step}. ${name}`, err instanceof Error ? err.message : String(err))
    return false
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const wallDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

interface TokenInfo {
  CompanyName?: string
  AppLocationId?: number
  AppLocationName?: string
}

interface ProductShape extends EposProduct {
  ProductType?: number
  CostPrice?: number | null
  IsSalePriceIncTax?: boolean
  IsCostPriceIncTax?: boolean
}

async function main(): Promise<void> {
  console.log('\nEpos Now smoke test (read-only)\n')

  // Named, never valued: this output gets pasted into chats and issues.
  const missing = EPOSNOW_VARS.filter((name) => !process.env[name])
  if (missing.length > 0) {
    console.log(`  \x1b[31mFAIL\x1b[0m  not configured — missing from .env: ${missing.join(', ')}`)
    console.log('\n  Nothing else can run until those are set.\n')
    process.exit(1)
  }
  if (!isConfigured()) {
    console.log('  \x1b[31mFAIL\x1b[0m  isConfigured() is false despite the variables being set')
    process.exit(1)
  }

  const client = eposnow()
  const location = Number(process.env.EPOSNOW_LOCATION_ID) || null

  const reached = await check('the key and secret are accepted', async () => {
    const info = await client.get<TokenInfo>('TokenInfo')
    return `${info.CompanyName ?? 'unnamed company'} · API device at ${info.AppLocationName ?? '?'} (location ${info.AppLocationId ?? '?'})`
  })
  if (!reached) {
    console.log('\n  The rest needs a working key. Stopping here.\n')
    process.exit(1)
  }

  await check('locations and tills are readable', async () => {
    const devices = await client.getAll<EposDevice>(
      'Device',
      { devicesForAllLocations: true },
      'pageNumber',
    )
    const byLocation = new Map<number | null, number>()
    for (const d of devices)
      byLocation.set(d.LocationId ?? null, (byLocation.get(d.LocationId ?? null) ?? 0) + 1)
    const summary = [...byLocation.entries()]
      .map(([loc, n]) => `${n} at location ${loc}`)
      .join(', ')

    if (location && !byLocation.has(location)) {
      throw new Error(
        `EPOSNOW_LOCATION_ID is ${location}, but no till is at that location (${summary})`,
      )
    }
    if (!location && byLocation.size > 1) {
      warn(
        'tills at more than one location, and EPOSNOW_LOCATION_ID is not set — every till counts towards the bar',
      )
    }
    return `${devices.length} tills: ${summary}`
  })

  await check('the product list and categories are readable', async () => {
    const [products, categories] = await Promise.all([
      client.getAll<ProductShape>('Product'),
      client.getAll<EposCategory>('Category'),
    ])
    const measured = products.filter((p) => p.ProductType === 2 || p.ProductType === 3).length
    const noCost = products.filter((p) => !p.CostPrice).length
    if (measured > 0) {
      warn(
        `${measured} measured or weighed products — check their units read sensibly in a till read`,
      )
    }
    if (noCost > 0) {
      warn(`${noCost} products have no cost price, so any night they sell reads richer than it was`)
    }
    const exTax = products.filter((p) => p.IsSalePriceIncTax === false).length
    return `${products.length} products, ${categories.length} top-level categories${exTax ? `, ${exTax} priced ex GST` : ''}`
  })

  await check('yesterday reads as a night off the till', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const day = wallDay(yesterday)
    const read = await readTill({ start: `${day}T00:00:00`, end: `${day}T23:59:59` })

    if (read.transactions === 0) {
      warn(`no completed sales on ${day} — try again the day after the bar trades`)
      return `${day}: no sales`
    }
    console.log(
      `        take $${read.take.toFixed(2)} GST incl · profit after stock $${read.profit.toFixed(2)} GST excl`,
    )
    console.log(
      `        ${read.transactions} sales, first ${read.firstSale}, last ${read.lastSale}`,
    )
    console.log(
      `        ${read.lines.length} products sold, ${read.missingCost} without a cost price`,
    )
    return `${day}: compare the take with Epos Now's End of Day report for that day`
  })

  if (failures > 0) {
    console.log(
      `\n\x1b[31m${failures} of ${step} checks failed.\x1b[0m Epos Now is not usable yet.\n`,
    )
    process.exit(1)
  }
  console.log(`\n\x1b[32mAll ${step} checks passed.\x1b[0m Bars can be closed off the till.\n`)
}

main().catch((err) => {
  console.error('\n\x1b[31mThe smoke test could not run.\x1b[0m\n')
  console.error(err instanceof Error ? err.message : err)
  console.error()
  process.exit(1)
})
