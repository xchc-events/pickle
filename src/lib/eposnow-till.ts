import { CFG } from './finance'
import type { SoldLine } from './bar'

/**
 * Reading a night off the till.
 *
 * Epos Now is the venue's till, its stock system, and what tells Xero about bar
 * sales. This product only reads it: the sales in a night's service window,
 * turned into the bar half of that night — take, cost of goods, profit, and
 * what sold. Nothing here writes to Epos Now, and nothing here posts to Xero;
 * Epos Now's own Xero app already sends the day's sales at till close, and a
 * second copy from here would count them twice.
 *
 * The shapes below use Epos Now's V4 field names as published in its Swagger
 * spec. Only the fields read are declared.
 *
 * Pure over plain shapes, so it is tested without a network.
 */

export interface EposTransactionItem {
  ProductId: number
  Quantity: number
  /** GST inclusive, per unit. */
  UnitPrice?: number | null
  UnitPriceExcTax?: number | null
  /** GST exclusive, per unit, as Epos Now held it at the time of the sale. */
  CostPrice?: number | null
  /** Taken off the line, GST inclusive, as the till shows it. */
  DiscountAmount?: number | null
}

/** An open-price sale rung up with no product behind it. */
export interface EposMiscItem {
  Name?: string | null
  Quantity: number
  UnitPrice?: number | null
  UnitPriceExcTax?: number | null
}

export interface EposTransaction {
  Id: number
  DateTime: string
  /** 1 completed, 7 held, 8 ordered. */
  StatusId: number
  DeviceId?: number | null
  /** GST inclusive, after discounts. */
  TotalAmount?: number | null
  /** A tip. Not takings. */
  Gratuity?: number | null
  TransactionItems?: EposTransactionItem[] | null
  MiscProductItems?: EposMiscItem[] | null
}

export interface EposProduct {
  Id: number
  Name: string
  CategoryId?: number | null
}

export interface EposCategory {
  Id: number
  Name: string
  Children?: EposCategory[] | null
}

export interface EposDevice {
  Id: number
  LocationId?: number | null
}

/** Epos Now's status for a sale that has been paid for. */
export const COMPLETED = 1

export interface TillRead {
  /** Completed sales counted. */
  transactions: number
  /** GST inclusive, tips excluded, refunds netted off. */
  take: number
  /** GST exclusive, from the cost prices Epos Now held for what sold. */
  costOfGoods: number
  /** The take less GST less cost of goods — what the bar half stores. */
  profit: number
  /** Biggest seller first. */
  lines: SoldLine[]
  /** Lines that sold with no cost price, so the profit is overstated by them. */
  missingCost: number
  firstSale: string | null
  lastSale: string | null
}

/** Every category's name by id, the children of a parent included. */
export function categoryNames(categories: EposCategory[]): Map<number, string> {
  const out = new Map<number, string>()
  const walk = (list: EposCategory[]) => {
    for (const c of list) {
      out.set(c.Id, c.Name)
      if (c.Children?.length) walk(c.Children)
    }
  }
  walk(categories)
  return out
}

const MISC = 'Open-price sales'

/**
 * The bar half of a night, off the sales Epos Now recorded in its window.
 *
 * Held and ordered tabs are left out — nothing has been paid for. A tip is not
 * takings. A refund nets off the night it was given. Profit is the take less
 * GST at the settlement's own divisor, less what the stock cost; a product
 * Epos Now held no cost price for is flagged rather than quietly costed at
 * nothing, because that overstates the margin in exactly the place a reader
 * would look for the reason it was good.
 */
export function tillRead(
  transactions: EposTransaction[],
  products: EposProduct[],
  categories: EposCategory[],
  opts: { devices?: Set<number> } = {},
): TillRead {
  const names = new Map(products.map((p) => [p.Id, p]))
  const catNames = categoryNames(categories)
  const lines = new Map<string, SoldLine>()

  const counted = transactions.filter(
    (t) =>
      t.StatusId === COMPLETED &&
      (!opts.devices || (t.DeviceId != null && opts.devices.has(t.DeviceId))),
  )

  let take = 0
  for (const t of counted) {
    const items = t.TransactionItems ?? []
    const misc = t.MiscProductItems ?? []

    let itemTotal = 0

    for (const i of items) {
      const product = names.get(i.ProductId)
      const key = `p:${i.ProductId}`
      const unitPrice = i.UnitPrice ?? 0
      const discount = i.DiscountAmount ?? 0
      const revenue = unitPrice * i.Quantity - discount
      const revenueEx =
        i.UnitPriceExcTax != null
          ? i.UnitPriceExcTax * i.Quantity - discount / CFG.gst
          : revenue / CFG.gst
      const costKnown = i.CostPrice != null && i.CostPrice > 0

      const line = lines.get(key) ?? {
        eposProductId: i.ProductId,
        name: product?.Name ?? `Product #${i.ProductId}`,
        category: product?.CategoryId != null ? (catNames.get(product.CategoryId) ?? null) : null,
        units: 0,
        revenue: 0,
        revenueEx: 0,
        cost: 0,
        costKnown: true,
      }
      line.units += i.Quantity
      line.revenue += revenue
      line.revenueEx += revenueEx
      line.cost += costKnown ? i.CostPrice! * i.Quantity : 0
      line.costKnown = line.costKnown && costKnown
      lines.set(key, line)
      itemTotal += revenue
    }

    for (const m of misc) {
      const name = m.Name?.trim() || MISC
      const key = `m:${name}`
      const revenue = (m.UnitPrice ?? 0) * m.Quantity
      const line = lines.get(key) ?? {
        eposProductId: null,
        name,
        category: null,
        units: 0,
        revenue: 0,
        revenueEx: 0,
        cost: 0,
        costKnown: false,
      }
      line.units += m.Quantity
      line.revenue += revenue
      line.revenueEx +=
        m.UnitPriceExcTax != null ? m.UnitPriceExcTax * m.Quantity : revenue / CFG.gst
      lines.set(key, line)
      itemTotal += revenue
    }

    take += (t.TotalAmount ?? itemTotal) - (t.Gratuity ?? 0)
  }

  const sold = [...lines.values()].sort((a, b) => b.revenue - a.revenue)
  const costOfGoods = sold.reduce((a, l) => a + l.cost, 0)
  const times = counted.map((t) => t.DateTime).sort()

  return {
    transactions: counted.length,
    take,
    costOfGoods,
    profit: take / CFG.gst - costOfGoods,
    lines: sold,
    missingCost: sold.filter((l) => !l.costKnown).length,
    firstSale: times[0] ?? null,
    lastSale: times[times.length - 1] ?? null,
  }
}
