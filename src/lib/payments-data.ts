import 'server-only'
import { db } from './db'
import { record } from './activity'
import { isConfigured, keyFingerprint, open, seal } from './secrets'
import { accountTail, formatAccount, irdTail, normaliseAccount, normaliseIrd } from './bank'
import {
  canReveal,
  maskAccount,
  maskIrd,
  validateDetails,
  type DetailsInput,
  type FieldError,
} from './payments'
import { modulesFor } from './permissions'
import type { SessionUser } from './session'

/**
 * Reading and writing payment details.
 *
 * The rules are in `payments.ts` and are tested there; this file is the part
 * that touches the database and the audit trail. Two things it guarantees:
 *
 *  - Nothing plaintext is ever written. `seal` is the only way in.
 *  - Nothing is ever decrypted without a row in the activity table saying who
 *    did it and against which event. A reveal with no reason to look is not a
 *    thing this module can express — `revealFor` takes an event, because
 *    "why were you reading this bank account" should always have an answer.
 */

export interface MaskedPayee {
  id: string
  name: string
  kind: 'ARTIST' | 'PROMOTER'
  country: string
  account: string
  ird: string
  accountName: string | null
  gstReg: boolean
  /** Null when the payee has never confirmed the details themselves. */
  confirmedAt: Date | null
  onFile: boolean
}

/** What Finance sees without decrypting anything. */
export async function maskedPayee(payeeId: string): Promise<MaskedPayee | null> {
  const p = await db.payee.findUnique({ where: { id: payeeId } })
  if (!p) return null

  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    country: p.country,
    account: maskAccount(p.bankTail),
    ird: maskIrd(p.irdTail),
    accountName: p.bankName,
    gstReg: p.gstReg,
    confirmedAt: p.detailsAt,
    onFile: p.bankEnc !== null,
  }
}

/**
 * `general` is for a problem that is not about anything the person typed —
 * the install being unfinished, mostly. It is separate from `errors` because
 * pinning "the venue has not set up encryption yet" onto their account number
 * field would tell them to go and fix the wrong thing.
 */
export type SaveResult = { ok: true } | { ok: false; errors?: FieldError[]; general?: string }

/**
 * Write a payee's details.
 *
 * Called from two places that look different and are the same operation: a
 * promoter filling in their own details in the portal, and a touring act
 * following a grant link. Neither is staff, and neither can read back what
 * they wrote — the form shows the mask afterwards, like everybody else's.
 */
export async function saveDetails(
  payeeId: string,
  input: DetailsInput,
  audit: { eventId: string | null; who: string },
): Promise<SaveResult> {
  // Checked before anything is validated: there is no point telling somebody
  // their account number is wrong when we could not have stored a right one.
  if (!isConfigured()) {
    console.error('PAYMENT_KEY is not set — a payee tried to submit details and could not.')
    return {
      ok: false,
      general:
        'The venue cannot accept payment details just yet. Let your coordinator know, and they will send you a fresh link.',
    }
  }

  const errors = validateDetails(input)
  if (errors.length) return { ok: false, errors }

  const account = normaliseAccount(input.account)
  const ird = input.ird.trim() ? normaliseIrd(input.ird) : null

  await db.payee.update({
    where: { id: payeeId },
    data: {
      // Prisma 7 types Bytes as Uint8Array<ArrayBuffer>; Buffer is a
      // Uint8Array<ArrayBufferLike>, which is wider. The copy is 30-odd bytes.
      bankEnc: new Uint8Array(seal(account)),
      bankTail: accountTail(account),
      bankName: input.accountName.trim(),
      irdEnc: ird ? new Uint8Array(seal(ird)) : null,
      irdTail: ird ? irdTail(ird) : null,
      country: input.country,
      detailsAt: new Date(),
    },
  })

  // The audit line never carries the number, only the fact and the tail —
  // the activity feed is read by everybody with the event open.
  if (audit.eventId) {
    await db.activity.create({
      data: {
        eventId: audit.eventId,
        who: audit.who,
        text: `payment details updated — account ending ${accountTail(account)}`,
      },
    })
  }

  return { ok: true }
}

export interface RevealedDetails {
  account: string
  accountName: string | null
  ird: string | null
}

export type RevealResult = { ok: true; details: RevealedDetails } | { ok: false; why: string }

/**
 * Decrypt a payee's details, in the context of an event.
 *
 * The event is not decoration. It is the answer to "why was this read", it is
 * what the audit row hangs off, and requiring it means there is no way to
 * browse the payee table decrypting as you go.
 *
 * Refuses outright in production unless a real credential backs the request
 * — `user.authenticated`, set in session.ts. See `canReveal` in payments.ts
 * for why that is not paranoia.
 */
export async function revealFor(
  user: SessionUser,
  payeeId: string,
  eventId: string,
): Promise<RevealResult> {
  const modules = await modulesFor(user)

  const verdict = canReveal({
    roleKey: user.roleKey,
    modules,
    external: user.external,
    authenticated: user.authenticated,
    production: process.env.NODE_ENV === 'production',
  })
  if (!verdict.ok) return { ok: false, why: verdict.why }

  if (!isConfigured()) {
    return { ok: false, why: 'PAYMENT_KEY is not set on this install, so nothing can be opened.' }
  }

  const p = await db.payee.findUnique({ where: { id: payeeId } })
  if (!p || !p.bankEnc) return { ok: false, why: 'Nothing is on file for this payee.' }

  // Written before the plaintext exists, so a decrypt that throws still
  // leaves the attempt on the record.
  await record(
    eventId,
    user,
    `revealed payment details for ${p.name} (account ending ${p.bankTail ?? '???'}, key ${keyFingerprint()})`,
  )

  return {
    ok: true,
    details: {
      account: formatAccount(open(Buffer.from(p.bankEnc))),
      accountName: p.bankName,
      ird: p.irdEnc ? open(Buffer.from(p.irdEnc)) : null,
    },
  }
}

/**
 * Forget a payee's details.
 *
 * The Privacy Act's ninth principle is that personal information is not kept
 * longer than it is needed for. Once an act is settled and paid there is no
 * further purpose for their account number, and this is how it goes. The
 * payee record itself stays — they may play again — but sealed and cleared.
 */
export async function forgetDetails(
  payeeId: string,
  user: SessionUser,
  eventId: string,
): Promise<void> {
  const p = await db.payee.findUnique({ where: { id: payeeId }, select: { name: true } })

  await db.payee.update({
    where: { id: payeeId },
    data: {
      bankEnc: null,
      bankTail: null,
      bankName: null,
      irdEnc: null,
      irdTail: null,
      detailsAt: null,
    },
  })

  await record(eventId, user, `erased payment details for ${p?.name ?? 'a payee'}`)
}
