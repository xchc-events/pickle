/**
 * New Zealand payment identifiers.
 *
 * Pure functions over strings, like `finance.ts` — no database, no secrets.
 * What is sealed is handled in `secrets.ts`; this file only decides whether a
 * thing a person typed is the kind of thing it claims to be, and reduces two
 * spellings of one number to one.
 *
 * The asymmetry that shapes every choice here: rejecting a valid account
 * means an artist does not get paid and nobody finds out until they chase it.
 * Accepting an invalid one means the bank rejects the batch, loudly, the same
 * day. So these checks are strict about *structure* and permissive about
 * anything that would require a registry we do not have.
 */

// --------------------------------------------------------- bank accounts ---

const BANK_DIGITS = 2
const BRANCH_DIGITS = 4
const BODY_DIGITS = 7
const SUFFIX_DIGITS = 3
const ACCOUNT_DIGITS = BANK_DIGITS + BRANCH_DIGITS + BODY_DIGITS + SUFFIX_DIGITS

/**
 * Strip the separators people type and pad a two-digit suffix to three.
 *
 * Banks issue both `…-00` and `…-000` for the same account, and a person will
 * write whichever their statement shows. Storing them as typed would seal two
 * different ciphertexts for one account and make them impossible to compare.
 */
export function normaliseAccount(input: string): string {
  const digits = input.replace(/\D/g, '')

  // A two-digit suffix is the only short form that is real; anything else
  // short is a typo and is left alone so `isBankAccount` can reject it.
  if (digits.length === ACCOUNT_DIGITS - 1) {
    const head = digits.slice(0, BANK_DIGITS + BRANCH_DIGITS + BODY_DIGITS)
    const suffix = digits.slice(BANK_DIGITS + BRANCH_DIGITS + BODY_DIGITS)
    return head + suffix.padStart(SUFFIX_DIGITS, '0')
  }

  return digits
}

/**
 * Whether this is structurally an NZ bank account.
 *
 * The prefix check is a sanity bound, not a bank directory: allocated bank
 * prefixes run 01–38 with 88 for one non-bank issuer. We deliberately do not
 * hard-code the registered list — Payments NZ maintains it, it changes when
 * banks merge, and a stale copy here would reject real accounts. 00 and 99
 * are the two that are certainly not accounts.
 */
export function isBankAccount(input: string): boolean {
  if (/[A-Za-z]/.test(input)) return false

  const n = normaliseAccount(input)
  if (n.length !== ACCOUNT_DIGITS) return false

  const bank = Number(n.slice(0, BANK_DIGITS))
  return (bank >= 1 && bank <= 38) || bank === 88
}

/** Render a normalised account back into the form on a bank statement. */
export function formatAccount(normalised: string): string {
  const n = normaliseAccount(normalised)
  if (n.length !== ACCOUNT_DIGITS) return normalised

  const a = BANK_DIGITS
  const b = a + BRANCH_DIGITS
  const c = b + BODY_DIGITS
  return `${n.slice(0, a)}-${n.slice(a, b)}-${n.slice(b, c)}-${n.slice(c)}`
}

/**
 * The three digits kept in the clear beside the sealed account.
 *
 * These come from the *account body*, not the suffix: suffixes are mostly
 * `000` and would tell two accounts at the same bank apart not at all. Three
 * digits is enough for a person to confirm they are looking at the right
 * account and few enough that the column is not a partial reconstruction of
 * the number it was encrypted to keep out of the database.
 */
export function accountTail(normalised: string): string {
  const n = normaliseAccount(normalised)
  if (n.length !== ACCOUNT_DIGITS) return ''

  const bodyEnd = BANK_DIGITS + BRANCH_DIGITS + BODY_DIGITS
  return n.slice(bodyEnd - 3, bodyEnd)
}

// ----------------------------------------------------------- IRD numbers ---

const IRD_MIN = 10_000_000
const IRD_MAX = 150_000_000

/** Nine digits, zero-padded. An eight-digit IRD number is a nine-digit one. */
export function normaliseIrd(input: string): string {
  return input.replace(/\D/g, '').padStart(9, '0')
}

/**
 * IRD's published modulus-11 check.
 *
 * The base is the first eight digits, the ninth is the check digit. If the
 * primary weighting yields a check digit of 10 — which is not a digit — the
 * secondary weighting is used instead. A number that yields 10 under both is
 * not a valid IRD number.
 */
function checkDigit(base: string, weights: readonly number[]): number {
  const sum = weights.reduce((acc, w, i) => acc + Number(base[i]) * w, 0)
  const remainder = sum % 11
  return remainder === 0 ? 0 : 11 - remainder
}

const PRIMARY = [3, 2, 7, 6, 5, 4, 3, 2] as const
const SECONDARY = [7, 4, 3, 2, 5, 2, 7, 6] as const

export function isIrdNumber(input: string): boolean {
  if (/[^\d\s-]/.test(input)) return false

  const digits = input.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 9) return false

  const n = normaliseIrd(digits)
  const value = Number(n)
  if (value < IRD_MIN || value > IRD_MAX) return false

  const base = n.slice(0, 8)
  const given = Number(n[8])

  const primary = checkDigit(base, PRIMARY)
  if (primary !== 10) return primary === given

  const secondary = checkDigit(base, SECONDARY)
  if (secondary === 10) return false
  return secondary === given
}

/** The last three digits, kept in the clear beside the sealed number. */
export function irdTail(normalised: string): string {
  const n = normalised.replace(/\D/g, '')
  return n.length >= 3 ? n.slice(-3) : ''
}

// ------------------------------------------------------------ withholding ---

/** The standard non-resident contractor rate where IRD has not set another. */
export const NRCT_DEFAULT = 0.15

export interface WithholdingInput {
  /** ISO country of tax residence. Null is treated as *not* New Zealand. */
  country: string | null
  /** A rate IRD has agreed for this payee, 0–1. Null means none agreed. */
  nrctRate: number | null
  /** Whether the payee holds a current certificate of exemption. */
  exempt: boolean
}

/**
 * What proportion of a fee is withheld at source.
 *
 * Every default here errs towards withholding. Withholding too much is
 * recoverable — the artist claims it back from IRD, and XCHC has the record.
 * Withholding too little leaves the venue carrying a liability it did not
 * know it had, which is the failure that is expensive and silent. So an
 * unknown country withholds, and only an explicit NZ or a sighted
 * certificate of exemption does not.
 */
export function withholdingRate(input: WithholdingInput): number {
  if (input.exempt) return 0
  if (input.country === 'NZ') return 0
  return input.nrctRate ?? NRCT_DEFAULT
}
