'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import { cleanBar } from '@/lib/actuals'
import { barRefusal, nightFromBudget, nightHasCome } from '@/lib/bar'
import { budgetToLock, tillWindowFor } from '@/lib/bar-data'
import { isConfigured, readTill } from '@/lib/eposnow'
import { EposError } from '@/lib/eposnow-client'
import type { TillRead } from '@/lib/eposnow-till'
import { money } from '@/lib/format'
import { said, type Said } from '@/lib/toast'
import type { SessionUser } from '@/lib/session'

/**
 * Bar's mutations.
 *
 * The bar half of a night is closed here, under the Bar permission — the bar
 * manager holds the till read and has no Pipeline permission. The door half is
 * counted on the event record. Neither place writes the other's figures.
 *
 * Nothing here orders stock or posts a sale to Xero. Epos Now does both.
 *
 * Every action re-checks the module, refuses an outside account, and scopes the
 * event for itself: a server action is a POST endpoint, and the page that drew
 * the button is not the boundary.
 */

type Gate = { ok: true; user: SessionUser; id: string } | { ok: false; why: string }

async function gate(eventId: string): Promise<Gate> {
  const { user } = await requireModule('bar')
  const refused = barRefusal(user)
  if (refused) return { ok: false, why: refused }
  const id = await requireEvent(user, eventId)
  return { ok: true, user, id }
}

/** The night must have come before its bar can be closed. */
async function nightCheck(id: string): Promise<string | null> {
  const ev = await db.event.findUniqueOrThrow({ where: { id }, select: { date: true } })
  return nightHasCome(ev.date, new Date())
    ? null
    : 'This night has not happened yet, so there is no bar to close.'
}

const afterClose = (doorCounted: boolean) =>
  doorCounted
    ? 'With the door already counted, the settlement now reads off counted figures, not the model.'
    : 'The bar margin reads off it now; tickets stay the model until the door is counted on the event record.'

/**
 * Close the bar by hand.
 *
 * For a till that is not connected, or a night the till got wrong. Stored as
 * MANUAL, and any product breakdown from an earlier till read is removed — it
 * described different figures, and a "why" that does not add up to the bar
 * half beside it is worse than none.
 */
export async function closeBarByHand(
  eventId: string,
  figures: { barTake: number; barProfit: number },
): Promise<Said> {
  const g = await gate(eventId)
  if (!g.ok) return said(g.why, 'stop')

  const notYet = await nightCheck(g.id)
  if (notYet) return said(notYet, 'warn')

  const clean = cleanBar(figures)
  if (!clean.ok) return said(clean.why, 'warn')

  const now = new Date()
  const [saved] = await db.$transaction([
    db.actual.upsert({
      where: { eventId: g.id },
      create: {
        eventId: g.id,
        ...clean.value,
        barSource: 'MANUAL',
        barReconciledBy: g.user.initials,
        barReconciledAt: now,
      },
      update: {
        ...clean.value,
        barSource: 'MANUAL',
        barReconciledBy: g.user.initials,
        barReconciledAt: now,
      },
      select: { tickets: true, ticketRev: true },
    }),
    db.barSale.deleteMany({ where: { eventId: g.id } }),
  ])

  await record(
    g.id,
    g.user,
    `closed the bar by hand — ${money(clean.value.barTake)} over the bar, ${money(clean.value.barProfit)} after stock`,
  )

  refresh()
  return said(`Bar closed by hand. ${afterClose(saved.tickets != null && saved.ticketRev != null)}`)
}

export type TillPreview =
  | {
      ok: true
      transactions: number
      take: number
      profit: number
      firstSale: string | null
      lastSale: string | null
      missingCost: number
      products: number
    }
  | { ok: false; why: string }

/** Read the till for the night's service window, and the reason it cannot be read. */
async function tillFor(
  id: string,
): Promise<{ ok: true; read: TillRead } | { ok: false; why: string }> {
  if (!isConfigured()) {
    return { ok: false, why: 'Epos Now is not connected on this install. Close the bar by hand.' }
  }

  const window = await tillWindowFor(id)
  if (!window) {
    return {
      ok: false,
      why: 'Doors and bar close are not both set on the event record, so there is no window to read the till for.',
    }
  }

  try {
    const read = await readTill(window)
    if (read.transactions === 0) {
      return {
        ok: false,
        why: `Epos Now has no completed sales between ${window.start.replace('T', ' ')} and ${window.end.replace('T', ' ')}. If the bar traded, check the run times on the event record. Nothing was saved.`,
      }
    }
    return { ok: true, read }
  } catch (err) {
    if (err instanceof EposError) return { ok: false, why: err.message }
    throw err
  }
}

/**
 * What the till says, without saving it.
 *
 * Shown before anybody closes the bar off it, so the figures are looked at by a
 * person first — the till is the record of the sales, but it is not always the
 * record of the night.
 */
export async function previewTill(eventId: string): Promise<TillPreview> {
  const g = await gate(eventId)
  if (!g.ok) return { ok: false, why: g.why }

  const notYet = await nightCheck(g.id)
  if (notYet) return { ok: false, why: notYet }

  const till = await tillFor(g.id)
  if (!till.ok) return till

  const r = till.read
  return {
    ok: true,
    transactions: r.transactions,
    take: r.take,
    profit: r.profit,
    firstSale: r.firstSale,
    lastSale: r.lastSale,
    missingCost: r.missingCost,
    products: r.lines.length,
  }
}

/**
 * Close the bar off Epos Now.
 *
 * Takes no figures. The server reads the till itself, again, rather than
 * trusting numbers sent back from a preview — which is the only reason a POS
 * source can be believed. What sold is stored beside it, replacing any earlier
 * read, so the bar screen's "why" always adds up to the bar half it explains.
 */
export async function closeBarFromTill(eventId: string): Promise<Said> {
  const g = await gate(eventId)
  if (!g.ok) return said(g.why, 'stop')

  const notYet = await nightCheck(g.id)
  if (notYet) return said(notYet, 'warn')

  const till = await tillFor(g.id)
  if (!till.ok) return said(till.why, 'warn')
  const r = till.read

  const clean = cleanBar({ barTake: r.take, barProfit: r.profit })
  if (!clean.ok) {
    return said(
      `Epos Now's figures do not add up to a night — ${clean.why} Check the till before closing by hand.`,
      'stop',
    )
  }

  const now = new Date()
  const [saved] = await db.$transaction([
    db.actual.upsert({
      where: { eventId: g.id },
      create: {
        eventId: g.id,
        ...clean.value,
        barSource: 'POS',
        barReconciledBy: g.user.initials,
        barReconciledAt: now,
      },
      update: {
        ...clean.value,
        barSource: 'POS',
        barReconciledBy: g.user.initials,
        barReconciledAt: now,
      },
      select: { tickets: true, ticketRev: true },
    }),
    db.barSale.deleteMany({ where: { eventId: g.id } }),
    db.barSale.createMany({
      data: r.lines.map((l) => ({
        eventId: g.id,
        eposProductId: l.eposProductId ?? null,
        name: l.name,
        category: l.category,
        units: l.units,
        revenue: l.revenue,
        revenueEx: l.revenueEx,
        cost: l.cost,
        costKnown: l.costKnown,
      })),
    }),
  ])

  await record(
    g.id,
    g.user,
    `closed the bar off Epos Now — ${r.transactions} sales, ${money(clean.value.barTake)} over the bar, ${money(clean.value.barProfit)} after stock`,
  )

  refresh()
  const costs =
    r.missingCost > 0
      ? ` ${r.missingCost} ${r.missingCost === 1 ? 'product has' : 'products have'} no cost price in Epos Now, so the profit is overstated by them.`
      : ''
  return said(
    `Bar closed off Epos Now. ${afterClose(saved.tickets != null && saved.ticketRev != null)}${costs}`,
    r.missingCost > 0 ? 'warn' : 'good',
  )
}

/**
 * Lock a budget for an event that went on sale before bar budgets existed.
 *
 * Every event that moves to On sale now locks one in the same transaction. The
 * ones already past it have nothing to be measured against; this gives them a
 * budget at today's projection and marks it LATE, so nobody mistakes it for
 * what was believed when tickets went live.
 */
export async function lockBudgetLate(eventId: string): Promise<Said> {
  const g = await gate(eventId)
  if (!g.ok) return said(g.why, 'stop')

  const ev = await db.event.findUniqueOrThrow({
    where: { id: g.id },
    select: { stage: true, barBudget: { select: { id: true } } },
  })
  if (ev.barBudget)
    return said('This night already has a budget. A budget is never rewritten.', 'warn')
  if (ev.stage < 4) {
    return said(
      'This locks by itself when the event goes on sale — there is nothing to lock yet.',
      'warn',
    )
  }

  const figures = await budgetToLock(g.id)
  if (!figures) return said('That event is not one you can budget.', 'stop')

  await db.barBudget.create({
    data: { eventId: g.id, ...figures, basis: 'LATE', lockedBy: g.user.initials },
  })
  const night = nightFromBudget(figures)
  await record(
    g.id,
    g.user,
    `locked the bar budget late — ${figures.heads} heads at ${money(figures.spendPerHead)}, ${money(night.margin)} after stock`,
  )

  refresh()
  return said(
    `Budget locked at ${money(night.margin)} after stock, at today's projection. It is marked late, so it reads as that rather than what was believed when tickets went on sale.`,
  )
}
