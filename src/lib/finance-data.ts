import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { dateLabel } from './format'
import { maskAccount, maskIrd } from './payments'
import { withholdingRate } from './bank'
import { grantStatus } from './grants'
import type { SessionUser } from './session'

/**
 * Loads Finance's payment side.
 *
 * Organised by event rather than by payee, and that is the whole design. A
 * bank account is read for a reason — to settle a particular show — and
 * `revealFor` in payments-data.ts requires the event for exactly that reason.
 * A page that listed payees on their own would invite reading details with no
 * reason to, and leave an audit trail that could not say why.
 *
 * Nothing here decrypts anything. Every figure on this page comes from the
 * `*Tail` columns, which are stored in the clear precisely so that the list
 * costs no decryption to draw.
 */

export interface PayableRow {
  /** EventArtist id, or 'promoter' for the org that brought the show. */
  id: string
  kind: 'artist' | 'promoter'
  name: string
  payeeId: string | null
  /** Masked, always. The reveal is a separate, audited act. */
  account: string
  ird: string
  accountName: string | null
  onFile: boolean
  confirmedAt: string | null
  country: string
  /** Proportion withheld at source. 0 for an NZ payee. */
  withholding: number
  /** Fee ceiling agreed on the booking. */
  fee: number
  paid: boolean
  openGrant: boolean
}

export interface FinanceQueueRow {
  id: string
  name: string
  date: string
  ready: number
  total: number
  tone: 'good' | 'warn' | 'stop'
  note: string
}

export interface FinanceEvent {
  id: string
  name: string
  date: string
  stage: number
  payables: PayableRow[]
}

export interface FinanceLoad {
  queue: FinanceQueueRow[]
  event: FinanceEvent | null
  /** False while the reveal path is sealed — see canReveal in payments.ts. */
  canReveal: boolean
  sealedReason: string | null
}

function payableFrom(
  id: string,
  kind: 'artist' | 'promoter',
  name: string,
  fee: number,
  paid: boolean,
  payee: {
    id: string
    bankTail: string | null
    irdTail: string | null
    bankName: string | null
    detailsAt: Date | null
    country: string
    nrctRate: number | null
    nrctExempt: boolean
    bankEnc: Uint8Array | null
    grants: { expires: Date; usedAt: Date | null; revokedAt: Date | null }[]
  } | null,
  now: Date,
): PayableRow {
  return {
    id,
    kind,
    name,
    payeeId: payee?.id ?? null,
    account: maskAccount(payee?.bankTail ?? null),
    ird: maskIrd(payee?.irdTail ?? null),
    accountName: payee?.bankName ?? null,
    onFile: payee?.bankEnc != null,
    confirmedAt: payee?.detailsAt ? dateLabel(payee.detailsAt) : null,
    country: payee?.country ?? 'NZ',
    withholding: payee
      ? withholdingRate({
          country: payee.country,
          nrctRate: payee.nrctRate,
          exempt: payee.nrctExempt,
        })
      : 0,
    fee,
    paid,
    openGrant: (payee?.grants ?? []).some((g) => grantStatus(g, now) === 'open'),
  }
}

const PAYEE_SELECT = {
  id: true,
  bankTail: true,
  irdTail: true,
  bankName: true,
  detailsAt: true,
  country: true,
  nrctRate: true,
  nrctExempt: true,
  bankEnc: true,
  grants: { select: { expires: true, usedAt: true, revokedAt: true } },
} as const

export async function loadFinance(
  user: SessionUser,
  wantedId: string | undefined,
  reveal: { allowed: boolean; why: string | null },
): Promise<FinanceLoad> {
  // Confirmed onwards, and concluded events too — a show is not finished for
  // Finance until it has been paid for, which happens after everyone else has
  // stopped looking at it.
  const events = await db.event.findMany({
    where: { AND: [{ stage: { gte: 2 } }, eventScope(user)] },
    orderBy: { date: 'desc' },
    select: {
      id: true,
      name: true,
      date: true,
      artists: { select: { payee: { select: { bankEnc: true } } } },
    },
    take: 30,
  })

  const queue: FinanceQueueRow[] = events.map((e) => {
    const total = e.artists.length
    const ready = e.artists.filter((a) => a.payee?.bankEnc != null).length
    return {
      id: e.id,
      name: e.name,
      date: dateLabel(e.date),
      ready,
      total,
      tone: total === 0 ? 'warn' : ready === total ? 'good' : ready === 0 ? 'stop' : 'warn',
      note:
        total === 0
          ? 'no acts'
          : ready === total
            ? 'everyone payable'
            : `${total - ready} without details`,
    }
  })

  const ids = events.map((e) => e.id)
  const chosen = wantedId && ids.includes(wantedId) ? wantedId : (ids[0] ?? null)
  if (!chosen) {
    return { queue, event: null, canReveal: reveal.allowed, sealedReason: reveal.why }
  }

  const row = await db.event.findUniqueOrThrow({
    where: { id: chosen },
    include: {
      artists: { orderBy: { order: 'asc' }, include: { payee: { select: PAYEE_SELECT } } },
      promoterPayee: { select: PAYEE_SELECT },
    },
  })

  const now = new Date()
  const payables: PayableRow[] = row.artists.map((a) =>
    payableFrom(a.id, 'artist', a.name, a.high, a.paid, a.payee, now),
  )

  if (row.promoterPayee) {
    payables.unshift(
      payableFrom(
        'promoter',
        'promoter',
        row.promoter ?? 'Promoter',
        0,
        false,
        row.promoterPayee,
        now,
      ),
    )
  }

  return {
    queue,
    canReveal: reveal.allowed,
    sealedReason: reveal.why,
    event: {
      id: row.id,
      name: row.name,
      date: dateLabel(row.date),
      stage: row.stage,
      payables,
    },
  }
}
