/**
 * What counts as a good enough password.
 *
 * NIST SP 800-63B rev. 4, not the bank-website rules: length is what makes a
 * password hard to guess, and "one capital, one digit, one symbol" is what
 * produces `Password1!`. So there are no composition rules here at all —
 * only a length, and a refusal of the passwords an attacker tries first.
 *
 * Fifteen characters because, at the time of writing, a password is the only
 * thing standing in front of an account: rev. 4 asks for fifteen when there is
 * no second factor and eight when there is. If a second factor is added, this
 * is the number to revisit — and nothing else in this file.
 *
 * Deliberately in-house and offline. A check against Have I Been Pwned's
 * breach corpus would catch far more than the short list below, and it is the
 * obvious next step, but it sends a hash prefix of every new password to a
 * third party and it would be the only outbound call on the sign-in path.
 * That is a decision to take on purpose, not by default.
 *
 * Pure, so every rule is testable.
 */

export const PASSWORD_MIN = 15
/** NIST asks for at least 64. The ceiling only stops a megabyte being hashed. */
export const PASSWORD_MAX = 128

export interface PasswordContext {
  email: string
  /** Anything the account is called — full names, first and last. */
  names?: (string | null | undefined)[]
}

export type PolicyVerdict = { ok: true } | { ok: false; why: string }

/**
 * The characters a password is judged on.
 *
 * Lowercased and stripped of spaces and punctuation, so that
 * `Mere-Tapu 2026!` and `meretapu2026` are recognised as the same idea.
 * Letters, digits and symbols (emoji included) survive; this is only ever
 * used to *judge* a password, never to hash one.
 */
function squash(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, '')
}

const chars = (s: string) => Array.from(s)

// --------------------------------------------------------------- the rules ---

/** How much has to be left once the guessable parts are taken out. */
const SUBSTANCE = 10

const TOO_SHORT = `Use at least ${PASSWORD_MIN} characters. A few ordinary words strung together is the easiest way there — spaces are fine.`
const TOO_LONG = `Keep it to ${PASSWORD_MAX} characters or fewer.`
const NO_SUBSTANCE =
  'That is mostly spaces and punctuation. Use a few words, so there is something to it.'
const REPEATED =
  'That repeats the same thing over and over, which is one of the first things a guesser tries. Use a few different words.'
const KNOWN_CONTEXT =
  'Too much of that is your name, your email address, the venue’s name, or a word everybody tries first. Add a few words of your own.'
const RUN =
  'That is mostly a run along the keyboard, the alphabet or the digits, which is one of the first things a guesser tries. Use a few words instead.'
const FAMOUS =
  'That one is on the lists of well-known passwords that get tried first. Choose words nobody has published.'

export function checkPassword(password: string, ctx: PasswordContext): PolicyVerdict {
  const length = chars(password.normalize('NFKC')).length
  if (length < PASSWORD_MIN) return { ok: false, why: TOO_SHORT }
  if (length > PASSWORD_MAX) return { ok: false, why: TOO_LONG }

  const core = squash(password)
  if (chars(core).length < SUBSTANCE) return { ok: false, why: NO_SUBSTANCE }

  if (isRepetition(core)) return { ok: false, why: REPEATED }

  if (chars(withoutTerms(core, termsFor(ctx))).length < SUBSTANCE) {
    return { ok: false, why: KNOWN_CONTEXT }
  }

  if (longestRun(core) * 2 >= chars(core).length) return { ok: false, why: RUN }

  if (FAMOUS_PASSWORDS.has(core)) return { ok: false, why: FAMOUS }

  return { ok: true }
}

// --------------------------------------------------------------- repetition ---

/**
 * Whether the whole string is one short unit typed over and over.
 *
 * "aaaa", "abcabcabc", "onetwoonetwoonetwo". A trailing partial unit still
 * counts ("abcabca"): the guesser generating these does not stop on a
 * boundary either.
 */
function isRepetition(core: string): boolean {
  const c = chars(core)
  for (let unit = 1; unit * 2 <= c.length; unit++) {
    if (c.every((ch, i) => ch === c[i % unit])) return true
  }
  return false
}

// ------------------------------------------------------- what is already known ---

/**
 * The venue's own words, and the ones everybody tries first.
 *
 * Kept short on purpose: each entry is removed from the password before its
 * substance is measured, so a common English word here would punish ordinary
 * passphrases. These are the words that are *only* ever in a password because
 * somebody was asked for one.
 */
const HOUSE_TERMS = [
  'picklepicklepickle',
  'pickle',
  'xchc',
  'christchurch',
  'otautahi',
  'ōtautahi',
  'password',
  'passw0rd',
  'letmein',
  'welcome',
  'qwerty',
  'iloveyou',
  'changeme',
  'admin',
  'secret',
]

/** The shortest piece of context worth removing. "jo" is in too many words. */
const MIN_TERM = 3

function termsFor({ email, names = [] }: PasswordContext): string[] {
  const [local = '', domain = ''] = email.toLowerCase().split('@')
  // Every label of the domain except the last, which is a TLD everybody shares.
  const labels = domain.split('.').slice(0, -1)

  const raw = [
    local,
    ...local.split(/[._+-]/),
    ...labels,
    ...names.flatMap((n) => (n ? [n, ...n.split(/\s+/)] : [])),
    ...HOUSE_TERMS,
  ]

  const terms = new Set(raw.map(squash).filter((t) => chars(t).length >= MIN_TERM))
  // Longest first, so "picklepicklepickle" goes before "pickle" can split it.
  return [...terms].sort((a, b) => chars(b).length - chars(a).length)
}

function withoutTerms(core: string, terms: string[]): string {
  return terms.reduce((left, term) => left.split(term).join(''), core)
}

// ------------------------------------------------------------ keyboard runs ---

/**
 * Orders a guesser walks along.
 *
 * Digits and the alphabet wrap round ("7890123"); keyboard rows and columns do
 * not. Each is also walked backwards. Written without punctuation, since the
 * password is judged with its punctuation removed.
 */
const SEQUENCES: { order: string; cyclic: boolean }[] = [
  { order: '0123456789', cyclic: true },
  { order: 'abcdefghijklmnopqrstuvwxyz', cyclic: true },
  { order: 'qwertyuiopasdfghjklzxcvbnm', cyclic: false },
  { order: '1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p', cyclic: false },
  { order: 'qazwsxedcrfvtgbyhnujmikolp', cyclic: false },
  { order: '1q2w3e4r5t6y7u8i9o0p', cyclic: false },
]

/** Each character's successor, per sequence and direction. */
const SUCCESSORS: Map<string, string>[] = SEQUENCES.flatMap(({ order, cyclic }) =>
  [order, [...order].reverse().join('')].map((o) => {
    const next = new Map<string, string>()
    for (let i = 0; i < o.length; i++) {
      if (i + 1 < o.length) next.set(o[i], o[i + 1])
      else if (cyclic) next.set(o[i], o[0])
    }
    return next
  }),
)

/** The longest stretch that follows any one sequence in one direction. */
function longestRun(core: string): number {
  const c = chars(core)
  let best = c.length ? 1 : 0

  for (const next of SUCCESSORS) {
    let run = 1
    for (let i = 1; i < c.length; i++) {
      run = next.get(c[i - 1]) === c[i] ? run + 1 : 1
      if (run > best) best = run
    }
  }
  return best
}

// ---------------------------------------------------------- the famous ones ---

/**
 * Long passwords that turn up at the top of published breach lists.
 *
 * A backstop, not the defence. The rules above already refuse the families
 * these lists are mostly made of — repeats, keyboard walks, a word padded with
 * digits — so this only has to hold the ones that are long, varied and famous
 * anyway. Stored squashed, the form they are compared in.
 */
const FAMOUS_PASSWORDS = new Set(
  [
    'correct horse battery staple',
    'the quick brown fox jumps over the lazy dog',
    'thequickbrownfox',
    'never gonna give you up',
    'may the force be with you',
    'welcome to the jungle',
    'supercalifragilisticexpialidocious',
    'i love you so much',
    'i love my family',
    'i love you forever',
    'i love you baby',
    'one two three four five',
    'onetwothreefour',
    'let me in please',
    'open sesame open sesame',
    'hello world hello',
    'helloworld123',
    'manchester united',
    'liverpool football club',
    'go all blacks',
    'all blacks forever',
    'kia ora koutou katoa',
    'aotearoa new zealand',
    'newzealand123',
    'zaq12wsxcde34rfv',
    'zaq1xsw2cde3vfr4',
    'mnbvcxzlkjhgfdsa',
    'q1w2e3r4t5y6u7i8',
    'a1b2c3d4e5f6g7h8',
    'abc123def456ghi789',
    'trustno1 trust no one',
    'blink182 blink',
    'iamthebest123',
    'youwillneverguess',
    'nobodywillguessthis',
    'dontforgetit',
    'thisisnotapassword',
    'mysupersecretpassword',
    'thisismypassword',
  ].map(squash),
)
