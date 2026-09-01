import { isBankAccount, isIrdNumber } from './bank'

/**
 * The rules around payment details.
 *
 * Pure, like `finance.ts` and `design.ts`, so the gate in front of a
 * decrypted bank account can be tested without a database or a session. The
 * sealing itself is in `secrets.ts`; the reads and writes are in
 * `payments-data.ts`.
 */

// ------------------------------------------------------------- the gate ---

export interface RevealContext {
  roleKey: string
  /** Modules this user's role carries, from ModulePermission. */
  modules: readonly string[]
  /** True for an external promoter. */
  external: boolean
  /**
   * Whether a real credential backs this request. False for the development
   * role picker, which is a cookie with nobody behind it — see
   * `currentUser()` in session.ts.
   */
  authenticated: boolean
  production: boolean
}

export type Verdict = { ok: true } | { ok: false; why: string }

/**
 * Whether this request may see a decrypted bank account.
 *
 * Three conditions, checked in the order a person would want them explained:
 *
 *  1. Finance, and only Finance. The module is the permission.
 *  2. Nobody outside the venue, whatever their module rows say. A promoter
 *     enters their own details and never reads them back — not their own,
 *     and certainly not an artist's.
 *  3. A real session. This is the one that is not about the user: until
 *     Auth.js replaces the cookie stub, anybody who can set a cookie can be
 *     the finance lead, so in production the answer is no regardless of who
 *     the cookie claims to be. Development is exempt so the module can be
 *     built and demonstrated against seed data.
 */
export function canReveal(ctx: RevealContext): Verdict {
  if (!ctx.modules.includes('finance')) {
    return { ok: false, why: 'Payment details are visible to Finance only.' }
  }

  if (ctx.external) {
    return {
      ok: false,
      why: 'Payment details are never revealed to anyone outside the venue.',
    }
  }

  if (ctx.production && !ctx.authenticated) {
    return {
      ok: false,
      why:
        'Payment details stay sealed until real sign-in is in place. The current session is a ' +
        'cookie with no credential behind it, which is not enough to unlock a bank account.',
    }
  }

  return { ok: true }
}

// -------------------------------------------------------------- masking ---

/**
 * What everybody sees instead.
 *
 * Built from the `bankTail` column, which is stored in the clear precisely so
 * that showing this costs no decryption. Finance can tell two accounts apart
 * here without either one being opened.
 */
export function maskAccount(tail: string | null): string {
  if (!tail) return 'Not on file'
  return `••-••••-••••${tail}-•••`
}

export function maskIrd(tail: string | null): string {
  if (!tail) return 'Not on file'
  return `•••-•••-${tail}`
}

// ----------------------------------------------------------- validation ---

export interface DetailsInput {
  account: string
  accountName: string
  ird: string
  /** ISO country of tax residence. */
  country: string
}

export interface FieldError {
  field: 'account' | 'accountName' | 'ird'
  message: string
}

/**
 * Check a set of details before anything is sealed.
 *
 * Returns every problem rather than the first, because the person filling
 * this in is usually a touring artist on a phone who will not come back for
 * a second round of one error at a time.
 */
export function validateDetails(input: DetailsInput): FieldError[] {
  const errors: FieldError[] = []

  if (!isBankAccount(input.account)) {
    errors.push({
      field: 'account',
      message: 'That is not an NZ bank account number. It looks like 01-0123-0123456-000.',
    })
  }

  if (!input.accountName.trim()) {
    errors.push({
      field: 'accountName',
      message:
        'The account holder name is needed — a name that does not match the account is what makes a payment bounce.',
    })
  }

  // A non-resident act has no IRD number to give, and requiring one would
  // stop them filling the form in at all. If they give one, it is checked.
  const irdGiven = input.ird.trim().length > 0
  const irdRequired = input.country === 'NZ'

  if (irdRequired && !irdGiven) {
    errors.push({ field: 'ird', message: 'An IRD number is required for an NZ payee.' })
  } else if (irdGiven && !isIrdNumber(input.ird)) {
    errors.push({ field: 'ird', message: 'That IRD number does not check out.' })
  }

  return errors
}
