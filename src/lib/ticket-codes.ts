import type { TicketCodeKind } from '@/generated/prisma/client'
import { money } from './format'

/**
 * Discount, free-ticket and tier-access codes — T6, 23 Sep 2026.
 *
 * A code changes nothing in the projection: `Event.sold` still comes from
 * Gather.rsvp via src/lib/gather.ts, and `uses` here is Gather's redemption
 * count, read back once that client exists. This file is what `addCode`
 * refuses on, and what the Codes section reads to show a code's state.
 */

/** sub | std | sup | door — the same four keys as `MixKey` in ticketing.ts,
 * named again here rather than imported so this file has no dependency on
 * the tiers table beyond agreeing on the four letters. */
export const TIER_KEYS = ['sub', 'std', 'sup', 'door'] as const
export type TierKey = (typeof TIER_KEYS)[number]

export const TICKET_CODE_KINDS: readonly TicketCodeKind[] = [
  'PERCENT_OFF',
  'AMOUNT_OFF',
  'FREE',
  'UNLOCKS_TIER',
]

export const TICKET_CODE_KIND_LABELS: Record<TicketCodeKind, string> = {
  PERCENT_OFF: 'Percent off',
  AMOUNT_OFF: 'Amount off',
  FREE: 'Free ticket',
  UNLOCKS_TIER: 'Unlocks a tier',
}

/** A typo-guard, not a business rule — the same ceiling `setTiers` puts on a
 * ticket price (`MAX_PRICE` in src/app/(app)/ticketing/actions.ts). Only
 * AMOUNT_OFF reads it; a percentage is bounded at 100 regardless. */
const MAX_AMOUNT_OFF = 500

/** Upper case, no spaces — what a guest types at checkout. */
export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

export interface TicketCodeInput {
  code: string
  kind: TicketCodeKind
  value: number | null
  tierKey: string | null
  useLimit: number | null
}

export type TicketCodeValidation = { ok: true; code: string } | { ok: false; error: string }

/** What `addCode` refuses on before anything reaches the database. */
export function validateTicketCode(input: TicketCodeInput): TicketCodeValidation {
  const code = normaliseCode(input.code)
  if (!code) return { ok: false, error: 'A code needs at least one character.' }
  if (!/^[A-Z0-9-]+$/.test(code)) {
    return { ok: false, error: 'A code is letters, numbers and dashes only.' }
  }

  if (input.tierKey !== null && !TIER_KEYS.includes(input.tierKey as TierKey)) {
    return { ok: false, error: 'Not a tier this event has.' }
  }
  if (input.kind === 'UNLOCKS_TIER' && input.tierKey === null) {
    return { ok: false, error: 'Unlocking a tier needs to say which one.' }
  }

  if (input.kind === 'FREE' || input.kind === 'UNLOCKS_TIER') {
    if (input.value !== null) {
      return {
        ok: false,
        error: `${TICKET_CODE_KIND_LABELS[input.kind]} carries no figure of its own — leave value blank.`,
      }
    }
  } else {
    if (input.value === null || !Number.isFinite(input.value) || input.value <= 0) {
      return { ok: false, error: 'That kind of code needs a value above zero.' }
    }
    if (input.kind === 'PERCENT_OFF' && input.value > 100) {
      return { ok: false, error: 'A percent off cannot be more than 100.' }
    }
    if (input.kind === 'AMOUNT_OFF' && input.value > MAX_AMOUNT_OFF) {
      return {
        ok: false,
        error: `${MAX_AMOUNT_OFF} is the ceiling. Above that is a typo more often than a discount.`,
      }
    }
  }

  if (input.useLimit !== null && (!Number.isInteger(input.useLimit) || input.useLimit <= 0)) {
    return {
      ok: false,
      error: 'Use limit has to be a whole number above zero, or left blank for unlimited.',
    }
  }

  return { ok: true, code }
}

export type TicketCodeState = 'active' | 'scheduled' | 'expired' | 'exhausted' | 'off'

export const CODE_STATE_LABELS: Record<TicketCodeState, string> = {
  active: 'Active',
  scheduled: 'Scheduled',
  expired: 'Expired',
  exhausted: 'Used up',
  off: 'Off',
}

/**
 * A code's state at `now`. Checked in order: turned off beats every date or
 * count; not live yet beats already finished; run out of uses is last,
 * since a code within its dates and still off or not yet started is not
 * "used up", whatever `uses` says.
 */
export function codeState(
  c: {
    active: boolean
    activeFrom: Date | null
    activeTo: Date | null
    useLimit: number | null
    uses: number
  },
  now: Date,
): TicketCodeState {
  if (!c.active) return 'off'
  if (c.activeFrom && now < c.activeFrom) return 'scheduled'
  if (c.activeTo && now > c.activeTo) return 'expired'
  if (c.useLimit !== null && c.uses >= c.useLimit) return 'exhausted'
  return 'active'
}

/** What a code does, in words — "10% off", "$5 off", "Free ticket", "Unlocks sup". */
export function codeValueLabel(
  kind: TicketCodeKind,
  value: number | null,
  tierKey: string | null,
): string {
  switch (kind) {
    case 'PERCENT_OFF':
      return `${value}% off`
    case 'AMOUNT_OFF':
      return `${money(value ?? 0)} off`
    case 'FREE':
      return 'Free ticket'
    case 'UNLOCKS_TIER':
      return tierKey ? `Unlocks ${tierKey}` : 'Unlocks a tier'
  }
}
