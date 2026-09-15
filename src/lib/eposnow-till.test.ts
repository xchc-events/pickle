import { describe, expect, it } from 'vitest'
import { CFG } from './finance'
import { cleanBar } from './actuals'
import {
  COMPLETED,
  categoryNames,
  tillRead,
  type EposCategory,
  type EposProduct,
  type EposTransaction,
} from './eposnow-till'

/**
 * Reading a night off the till.
 *
 * Epos Now is the system of record for every bar sale. This turns the sales in
 * a service window into the bar half of the night — the take, what the stock
 * cost, the profit, and what sold — in exactly the terms the settlement stores.
 *
 * The fixtures use Epos Now's own V4 field names, as published in its Swagger
 * spec (developer.eposnowhq.com/docs/v4/json). There are no live credentials
 * behind these tests; `npm run eposnow:smoke` is what checks the shapes against
 * the venue's real account.
 */

const products: EposProduct[] = [
  { Id: 11, Name: 'Pale ale — tap 1', CategoryId: 2 },
  { Id: 12, Name: 'House pour', CategoryId: 3 },
  { Id: 13, Name: 'Soda water', CategoryId: 4 },
]

const categories: EposCategory[] = [
  {
    Id: 1,
    Name: 'Drinks',
    Children: [
      { Id: 2, Name: 'Tap' },
      { Id: 3, Name: 'Spirits' },
    ],
  },
  { Id: 4, Name: 'Low & no' },
]

const sale = (over: Partial<EposTransaction> = {}): EposTransaction => ({
  Id: 1,
  DateTime: '2026-09-19T21:04:00',
  StatusId: COMPLETED,
  DeviceId: 7,
  TotalAmount: 33,
  Gratuity: 0,
  TransactionItems: [
    {
      ProductId: 11,
      Quantity: 3,
      UnitPrice: 11,
      UnitPriceExcTax: 11 / CFG.gst,
      CostPrice: 3.85,
      DiscountAmount: 0,
    },
  ],
  MiscProductItems: [],
  ...over,
})

describe('categoryNames', () => {
  it('names every category, children included', () => {
    const names = categoryNames(categories)
    expect(names.get(2)).toBe('Tap')
    expect(names.get(4)).toBe('Low & no')
  })
})

describe('tillRead', () => {
  it('takes the completed sales in the window', () => {
    const read = tillRead([sale(), sale({ Id: 2, TotalAmount: 11 })], products, categories)
    expect(read.transactions).toBe(2)
    expect(read.take).toBe(44)
  })

  it('leaves out held and ordered tabs — nothing has been paid for yet', () => {
    const read = tillRead(
      [sale(), sale({ Id: 2, StatusId: 7 }), sale({ Id: 3, StatusId: 8 })],
      products,
      categories,
    )
    expect(read.transactions).toBe(1)
  })

  it('does not count a tip as takings', () => {
    expect(tillRead([sale({ TotalAmount: 38, Gratuity: 5 })], products, categories).take).toBe(33)
  })

  it('nets a refund off the night', () => {
    const refund = sale({
      Id: 2,
      TotalAmount: -11,
      TransactionItems: [
        {
          ProductId: 11,
          Quantity: -1,
          UnitPrice: 11,
          UnitPriceExcTax: 11 / CFG.gst,
          CostPrice: 3.85,
          DiscountAmount: 0,
        },
      ],
    })
    const read = tillRead([sale(), refund], products, categories)
    expect(read.take).toBe(22)
    expect(read.lines[0]!.units).toBe(2)
    expect(read.costOfGoods).toBeCloseTo(2 * 3.85, 6)
  })

  it('adds up what sold by product, named and grouped as Epos Now has them', () => {
    const read = tillRead(
      [
        sale(),
        sale({
          Id: 2,
          TotalAmount: 20,
          TransactionItems: [
            {
              ProductId: 12,
              Quantity: 2,
              UnitPrice: 10,
              UnitPriceExcTax: 10 / CFG.gst,
              CostPrice: 2.3,
              DiscountAmount: 0,
            },
          ],
        }),
      ],
      products,
      categories,
    )

    const pale = read.lines.find((l) => l.name === 'Pale ale — tap 1')!
    expect(pale.category).toBe('Tap')
    expect(pale.units).toBe(3)
    expect(pale.revenue).toBeCloseTo(33, 6)
    expect(pale.revenueEx).toBeCloseTo(33 / CFG.gst, 6)
    expect(pale.cost).toBeCloseTo(3 * 3.85, 6)
    expect(read.lines.find((l) => l.name === 'House pour')!.category).toBe('Spirits')
  })

  /**
   * The bar half stores profit after stock, GST exclusive, and the settlement
   * reads it straight onto the bar margin line. So the profit is the take less
   * GST less what the stock cost — the same divisor the settlement uses — and
   * it has to pass the same check a figure typed by hand does.
   */
  it('works out profit in the terms the bar half stores', () => {
    const read = tillRead([sale(), sale({ Id: 2 })], products, categories)
    expect(read.profit).toBeCloseTo(66 / CFG.gst - 6 * 3.85, 6)
    expect(cleanBar({ barTake: read.take, barProfit: read.profit }).ok).toBe(true)
  })

  it('takes an item discount off the line', () => {
    const read = tillRead(
      [
        sale({
          TotalAmount: 30,
          TransactionItems: [
            {
              ProductId: 11,
              Quantity: 3,
              UnitPrice: 11,
              UnitPriceExcTax: 11 / CFG.gst,
              CostPrice: 3.85,
              DiscountAmount: 3,
            },
          ],
        }),
      ],
      products,
      categories,
    )
    expect(read.lines[0]!.revenue).toBeCloseTo(30, 6)
    expect(read.lines[0]!.revenueEx).toBeCloseTo(33 / CFG.gst - 3 / CFG.gst, 6)
  })

  it('flags a product with no cost price instead of costing it at nothing', () => {
    const read = tillRead(
      [
        sale({
          TotalAmount: 9,
          TransactionItems: [
            {
              ProductId: 13,
              Quantity: 2,
              UnitPrice: 4.5,
              UnitPriceExcTax: 4.5 / CFG.gst,
              CostPrice: null,
              DiscountAmount: 0,
            },
          ],
        }),
      ],
      products,
      categories,
    )
    expect(read.lines[0]!.costKnown).toBe(false)
    expect(read.missingCost).toBe(1)
  })

  it('shows an open-price sale under its own name, with no cost', () => {
    const read = tillRead(
      [
        sale({
          TotalAmount: 40,
          TransactionItems: [],
          MiscProductItems: [
            { Name: 'Corkage', Quantity: 1, UnitPrice: 40, UnitPriceExcTax: 40 / CFG.gst },
          ],
        }),
      ],
      products,
      categories,
    )
    expect(read.lines[0]!.name).toBe('Corkage')
    expect(read.lines[0]!.costKnown).toBe(false)
  })

  it('falls back to the product number for a product it cannot name', () => {
    const read = tillRead(
      [sale({ TransactionItems: [{ ProductId: 99, Quantity: 1, UnitPrice: 5, CostPrice: 2 }] })],
      products,
      categories,
    )
    expect(read.lines[0]!.name).toBe('Product #99')
    expect(read.lines[0]!.revenueEx).toBeCloseTo(5 / CFG.gst, 6)
  })

  it('reads only the venue’s own tills when told which they are', () => {
    const read = tillRead([sale(), sale({ Id: 2, DeviceId: 99 })], products, categories, {
      devices: new Set([7]),
    })
    expect(read.transactions).toBe(1)
  })

  it('reads a night with no sales as nothing, not as an error', () => {
    const read = tillRead([], products, categories)
    expect(read).toMatchObject({ transactions: 0, take: 0, profit: 0, firstSale: null })
    expect(read.lines).toEqual([])
  })

  it('says when the first and last sale went through', () => {
    const read = tillRead(
      [sale({ DateTime: '2026-09-19T23:40:00' }), sale({ Id: 2, DateTime: '2026-09-19T19:31:00' })],
      products,
      categories,
    )
    expect(read.firstSale).toBe('2026-09-19T19:31:00')
    expect(read.lastSale).toBe('2026-09-19T23:40:00')
  })

  it('puts the biggest seller first', () => {
    const read = tillRead(
      [
        sale(),
        sale({
          Id: 2,
          TotalAmount: 100,
          TransactionItems: [
            {
              ProductId: 12,
              Quantity: 10,
              UnitPrice: 10,
              UnitPriceExcTax: 10 / CFG.gst,
              CostPrice: 2.3,
            },
          ],
        }),
      ],
      products,
      categories,
    )
    expect(read.lines.map((l) => l.name)).toEqual(['House pour', 'Pale ale — tap 1'])
  })
})
