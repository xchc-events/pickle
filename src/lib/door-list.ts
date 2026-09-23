import type { DoorListEntryKind } from '@/generated/prisma/client'

/**
 * The door's own guest list — T7, 23 Sep 2026, and the guest list PG-11
 * (docs/product-gaps.md) asks for. Built in Pickle now, pushed to
 * Gather.rsvp once its comps and door APIs exist (docs/gather-rsvp-api.md,
 * sections 5.2 and 6.1).
 *
 * Kept deliberately small: grouping, totals and the one figure that reaches
 * money. The list itself, the add form and the print view are assembled in
 * src/app/(app)/ticketing from what this file computes; `financeVals` in
 * src/lib/finance.ts is untouched and still does the arithmetic.
 */

/** The fixed order the door list section and the print view show groups in. */
export const DOOR_LIST_KINDS: readonly DoorListEntryKind[] = ['GUEST', 'COMP', 'INDUSTRY', 'ACT']

export const DOOR_LIST_KIND_LABELS: Record<DoorListEntryKind, string> = {
  GUEST: 'Guest',
  COMP: 'Comp',
  INDUSTRY: 'Industry',
  ACT: 'Act',
}

export interface DoorListRow {
  id: string
  name: string
  partySize: number
  kind: DoorListEntryKind
  note: string | null
  who: string
  addedAt: Date
  checkedIn: number
}

export interface DoorListGroup {
  kind: DoorListEntryKind
  label: string
  rows: DoorListRow[]
  people: number
}

/** People across a set of entries — party sizes summed, not rows counted. */
export function totalPeople(entries: readonly { partySize: number }[]): number {
  return entries.reduce((n, e) => n + e.partySize, 0)
}

/**
 * Grouped by kind, in `DOOR_LIST_KINDS` order, with kinds that have nothing
 * on them left out rather than shown empty.
 */
export function groupDoorList(rows: readonly DoorListRow[]): DoorListGroup[] {
  return DOOR_LIST_KINDS.map((kind) => {
    const inKind = rows.filter((r) => r.kind === kind)
    return { kind, label: DOOR_LIST_KIND_LABELS[kind], rows: inKind, people: totalPeople(inKind) }
  }).filter((g) => g.rows.length > 0)
}

/**
 * What the comps P&L line counts — `crew * tok * tokenPrice * stockCost` in
 * src/lib/finance.ts, `crew` being this function's return value, passed in
 * by the loader exactly where `row.crew` used to go.
 *
 * The door list's COMP entries, party sizes summed, once any exist for the
 * event; the typed `Event.crew` figure exactly as it worked before this
 * file existed, until then. Never both added together — a list that has
 * started is the count, not a correction to the old guess.
 */
export function compsCountFor(
  entries: readonly { kind: DoorListEntryKind; partySize: number }[],
  typedCrew: number,
): number {
  const comps = entries.filter((e) => e.kind === 'COMP')
  return comps.length > 0 ? totalPeople(comps) : typedCrew
}

/** A non-negative whole party size — the one figure that reaches money. */
export function validPartySize(n: number): boolean {
  return Number.isInteger(n) && n >= 1
}

/** What `addDoorListEntry` refuses before it ever reaches the database. */
export function validateDoorListEntry(input: {
  name: string
  partySize: number
  kind: string
}): { ok: true } | { ok: false; error: string } {
  if (!input.name.trim()) return { ok: false, error: 'A name is needed for the door.' }
  if (!validPartySize(input.partySize)) {
    return { ok: false, error: 'Party size has to be a whole number, at least 1.' }
  }
  if (!DOOR_LIST_KINDS.includes(input.kind as DoorListEntryKind)) {
    return { ok: false, error: 'Not a kind of entry the door list knows.' }
  }
  return { ok: true }
}
