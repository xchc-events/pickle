import { CFG, type FinanceVals } from './finance'

/**
 * What a night counted, in two halves.
 *
 * The door and the bar are reconciled by different people off different
 * sources. The coordinator counts the door off Gather.rsvp and the door sheet;
 * the bar manager closes the bar off the till. Until this split they shared one
 * all-or-nothing row behind the Pipeline permission, so the person holding the
 * till read could not enter it, and whoever entered the door had to invent the
 * bar or wait.
 *
 * Each half is in only when both of its figures are. The settlement
 * substitutes whichever halves are in and leaves the rest projected; the gate
 * on putting a night to bed waits for both.
 *
 * Pure over plain shapes, so the substitution is tested rather than trusted.
 */

/** The four reconciled figures as stored — any of them may not be in yet. */
export interface ActualFigures {
  /** People through the door, counted — not tickets sold. */
  tickets: number | null
  /** Ticket takings, GST inclusive. */
  ticketRev: number | null
  /** Gross over the bar, GST inclusive — what the till took. */
  barTake: number | null
  /** Bar profit after stock, GST exclusive — already a margin. */
  barProfit: number | null
}

export interface DoorCount {
  tickets: number
  ticketRev: number
}

export interface BarClose {
  barTake: number
  barProfit: number
}

export interface Halves {
  door: DoorCount | null
  bar: BarClose | null
}

export function halvesOf(row: ActualFigures | null): Halves {
  if (!row) return { door: null, bar: null }

  // `!= null` rather than truthiness: a bar that took $0 is closed, and
  // reading zero as missing would hold that event at the gate forever.
  const door =
    row.tickets != null && row.ticketRev != null
      ? { tickets: row.tickets, ticketRev: row.ticketRev }
      : null
  const bar =
    row.barTake != null && row.barProfit != null
      ? { barTake: row.barTake, barProfit: row.barProfit }
      : null

  return { door, bar }
}

/** Whether the whole night is counted. The last gate waits on this. */
export const isReconciled = (h: Halves): boolean => h.door !== null && h.bar !== null

/**
 * What a counted night took: the Pipeline's "took $X", and Home's revenue.
 *
 * Ex-GST income — ticket takings with GST taken off, plus bar profit, the
 * same basis `financeVals` uses for `income` — and only once both halves are
 * in: half a night read as its take would be a counted figure plus nothing.
 * One function so no two screens can disagree about it.
 *
 * `ticketRev` is stored GST inclusive and `barProfit` GST exclusive (see
 * `ActualFigures`), so the ticket side has GST taken off before the two are
 * added. Fixed 22 September 2026 — see PG-20 in docs/product-gaps.md, which
 * this used to add on two different GST bases.
 */
export const takenOf = (h: Halves): number | null =>
  h.door && h.bar ? h.door.ticketRev / CFG.gst + h.bar.barProfit : null

export type Cleaned<T> = { ok: true; value: T } | { ok: false; why: string }

const isNumber = (n: number) => Number.isFinite(n)

/**
 * A door count as somebody typed it, or the sentence saying why not.
 *
 * Refused rather than clamped. A negative count stored as zero is a typo that
 * turned into a night nobody came to, and it reaches the settlement.
 */
export function cleanDoor(input: DoorCount): Cleaned<DoorCount> {
  if (!isNumber(input.tickets) || !isNumber(input.ticketRev)) {
    return { ok: false, why: 'Those figures do not read as numbers — nothing was saved.' }
  }
  if (input.tickets < 0 || input.ticketRev < 0) {
    return { ok: false, why: 'A door count cannot be negative. Nothing was saved.' }
  }
  if (!Number.isInteger(input.tickets)) {
    return { ok: false, why: 'People through the door is a whole number.' }
  }
  return { ok: true, value: { tickets: input.tickets, ticketRev: input.ticketRev } }
}

/**
 * A bar close as somebody typed it, or the sentence saying why not.
 *
 * Profit after stock is what is left of the GST-exclusive take once the stock
 * is paid for, so it cannot exceed that take. A figure that does almost always
 * means one of the two was typed in the wrong GST terms — the slip that moves a
 * settlement without anybody noticing — so it is refused in words.
 */
export function cleanBar(input: BarClose): Cleaned<BarClose> {
  if (!isNumber(input.barTake) || !isNumber(input.barProfit)) {
    return { ok: false, why: 'Those figures do not read as numbers — nothing was saved.' }
  }
  if (input.barTake < 0 || input.barProfit < 0) {
    return { ok: false, why: 'Bar takings and profit cannot be negative. Nothing was saved.' }
  }
  // A cent of tolerance, so a profit typed as the ex-GST take to the cent is
  // not refused over floating point.
  if (input.barProfit > input.barTake / CFG.gst + 0.01) {
    return {
      ok: false,
      why: 'That is more profit than the bar took once GST is out. The take is GST included and the profit is after stock, GST excluded — check which way round they went.',
    }
  }
  return { ok: true, value: { barTake: input.barTake, barProfit: input.barProfit } }
}

/**
 * The settlement's figures with whichever halves are counted substituted in.
 *
 * The same arithmetic `financeVals` does over counted inputs, not a second
 * version of it: attendance and the average come off the door, the bar margin
 * is what the bar actually made, and everything downstream of income is
 * re-derived exactly as finance.ts derives it. The cost side is untouched —
 * counting the takings does not move a wage. The test that counts exactly what
 * was projected and expects nothing to change is what holds this to that.
 *
 * A half that is not in stays projected. It is never zeroed: a bar closed
 * before the door is counted must not wipe the ticket line out of the sheet.
 */
export function countedVals(vals: FinanceVals, split: number, halves: Halves): FinanceVals {
  if (!halves.door && !halves.bar) return vals

  const out: FinanceVals = { ...vals }

  if (halves.door) {
    out.att = halves.door.tickets
    out.avg = halves.door.tickets > 0 ? halves.door.ticketRev / halves.door.tickets : 0
    out.ticketsEx = halves.door.ticketRev / CFG.gst
  }

  if (halves.bar) {
    out.barMarg = halves.bar.barProfit
  }

  out.income = out.ticketsEx + out.barMarg
  out.surplus = out.income - out.fixed
  out.theirShare = Math.max(0, out.surplus) * split
  out.ours = out.surplus - out.theirShare

  return out
}
