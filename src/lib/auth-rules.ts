import type { AuthTokenPurpose, Role } from '@/generated/prisma/client'

/**
 * Who may sign in, and who may change that.
 *
 * Pure, so the rules that decide whether a stranger gets into the venue's
 * pipeline can be tested without a database or a network — the same reason
 * `scope.ts` is kept free of `server-only`.
 *
 * The governing rule: **there is no self-signup.** This is one venue's
 * internal tool. An account exists because an administrator made it, and an
 * OAuth provider vouching for somebody's email address is not the same thing
 * as XCHC having decided they work here.
 */

export type Verdict = { ok: true } | { ok: false; why: string }

export interface Applicant {
  email: string
  /** Whether a User row already exists for this address. */
  known: boolean
  active: boolean
}

export type AdmissionCode = 'unknown' | 'inactive'
export type Admission = { ok: true } | { ok: false; why: string; code: AdmissionCode }

/**
 * Whether this address may sign in.
 *
 * Inactive is checked first: somebody who has left should be told their
 * access has ended, not told they do not exist.
 */
export function mayAdmit(a: Applicant): Admission {
  if (a.known && !a.active) {
    return {
      ok: false,
      code: 'inactive',
      why: 'That account has been switched off. If that is wrong, ask an administrator at the venue.',
    }
  }

  if (!a.known) {
    return {
      ok: false,
      code: 'unknown',
      why: 'There is no account for that address. Somebody has to be added by an administrator before they can sign in — this is not a service you can sign up to.',
    }
  }

  return { ok: true }
}

/**
 * One spelling per address.
 *
 * Lowercased and trimmed, because providers disagree about case and a user
 * typing their own address will not match otherwise. Dots in the local part
 * are left alone: Gmail treats them as insignificant and almost nobody else
 * does, so stripping them would merge two people who are not the same person.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

interface Actor {
  id: string
  role: Role
}

interface Target {
  id: string
  role: Role
  active: boolean
}

const ADMIN_ONLY = 'Only an administrator can change who has access.'

/**
 * The floor under the admin count.
 *
 * Two ways to lock every person out of the venue's own tool: switch off the
 * last admin, or demote them. Neither is recoverable from inside the product
 * — it would take somebody with database access — so both are refused rather
 * than warned about.
 */
const LAST_ADMIN =
  'That is the last administrator. Removing them would lock everybody out of Admin with no way back in from here — promote somebody else first.'

export function mayDeactivate(actor: Actor, target: Target, activeAdmins: number): Verdict {
  if (actor.role !== 'ADMIN') return { ok: false, why: ADMIN_ONLY }

  if (actor.id === target.id && target.active) {
    return {
      ok: false,
      why: 'You cannot switch off your own account. Ask another administrator to do it.',
    }
  }

  // Only a *deactivation* can breach the floor. Turning an account back on
  // never reduces the count.
  if (target.active && target.role === 'ADMIN' && activeAdmins <= 1) {
    return { ok: false, why: LAST_ADMIN }
  }

  return { ok: true }
}

export function mayChangeRole(
  actor: Actor,
  target: Target,
  next: Role,
  activeAdmins: number,
): Verdict {
  if (actor.role !== 'ADMIN') return { ok: false, why: ADMIN_ONLY }

  const losingAnAdmin = target.active && target.role === 'ADMIN' && next !== 'ADMIN'
  if (losingAnAdmin && activeAdmins <= 1) return { ok: false, why: LAST_ADMIN }

  return { ok: true }
}

export interface UserShape {
  role: Role
  /** The organisation an external account is scoped to. A `Payee` id. */
  organisationId: string | null
  personId: string | null
}

/**
 * Ways an account is set up wrongly.
 *
 * None of these is an error — the account works — but each one means somebody
 * will find the product mysteriously empty and not know why. Better said out
 * loud in Admin than discovered on a Friday night.
 */
export function userProblems(u: UserShape): string[] {
  const problems: string[] = []

  if (u.role === 'PROMOTER') {
    if (!u.organisationId) {
      problems.push(
        'No promoter organisation, so this account matches no events at all and the portal will be empty.',
      )
    }
    // A promoter has no shifts and no timesheet; a person record would be
    // claiming they are staff.
    return problems
  }

  if (u.organisationId) {
    problems.push(
      'A staff account carrying a promoter organisation. The organisation is ignored for internal roles — clear it to avoid confusion.',
    )
  }

  if (!u.personId) {
    problems.push(
      'Not linked to a person, so they cannot be rostered and their hours have nowhere to go.',
    )
  }

  return problems
}

// ----------------------------------------------------------- sign-in links ---

/**
 * How long an account must wait between emailed links of any kind — sign-in,
 * invitation or reset.
 *
 * Short enough that a real person who mistyped their address and tried again
 * barely notices, long enough that the form is not a way to send somebody a
 * hundred emails.
 */
export const LINK_COOLDOWN_SECONDS = 60

/**
 * A refusal carries the seconds as a number, not only inside its sentence.
 *
 * The sign-in page renders its own copy and cannot parse a count back out of
 * prose, so the number travels separately. `why` stays for the places that
 * want one ready-made sentence — the provider's own throw, and the log.
 */
export type LinkVerdict = { ok: true } | { ok: false; why: string; seconds: number }

/**
 * Whether to send another sign-in link to this address.
 *
 * This is an availability guard rather than a secrecy one. Every link is a
 * real email against a finite quota, and a form that will send unlimited ones
 * lets anybody exhaust the venue's allowance and lock out the people who need
 * to get in.
 *
 * A timestamp in the future is treated as no timestamp. A clock that has gone
 * backwards should not lock somebody out permanently with no way to explain
 * why — failing open on a nonsense value is the right direction here, because
 * the worst case is one extra email.
 */
export function mayRequestLink(lastSentAt: Date | null, now: Date): LinkVerdict {
  if (!lastSentAt) return { ok: true }

  const elapsed = (now.getTime() - lastSentAt.getTime()) / 1000
  if (elapsed < 0) return { ok: true }
  if (elapsed >= LINK_COOLDOWN_SECONDS) return { ok: true }

  const seconds = Math.ceil(LINK_COOLDOWN_SECONDS - elapsed)
  return {
    ok: false,
    seconds,
    why: `A link was already sent to that address. Check the inbox, or try again in ${seconds} seconds.`,
  }
}

/** How long each kind of emailed link lives. */
export const TOKEN_TTL_SECONDS: Record<AuthTokenPurpose, number> = {
  /** A link is a credential, and one left unread overnight is a credential left overnight. */
  SIGN_IN: 60 * 60,
  /** The same hour. Somebody who asked for a reset is waiting for it. */
  RESET: 60 * 60,
  /** A week, because it is sent to somebody who has not started yet. */
  INVITE: 7 * 24 * 60 * 60,
}

export type TokenState = 'open' | 'used' | 'expired'

/** Where an emailed link stands. Spent on first use, unlike an `AccessGrant`. */
export function tokenState(t: { expires: Date; usedAt: Date | null }, now: Date): TokenState {
  if (t.usedAt) return 'used'
  if (t.expires.getTime() <= now.getTime()) return 'expired'
  return 'open'
}

/**
 * The address emailed links point at, or null if there is no safe one.
 *
 * Taken from configuration, never from the request. A link built from the Host
 * header can be pointed anywhere by whoever sends the request, and then the
 * victim's own click delivers their reset token to that server — "password
 * reset poisoning". In production an unset address is a refusal rather than a
 * guess, because a link to localhost is a link to nowhere.
 */
export function linkBase(
  configured: string | undefined,
  nodeEnv: string | undefined,
): string | null {
  const url = configured?.trim()
  if (url) return url.replace(/\/+$/, '')
  return nodeEnv === 'production' ? null : 'http://localhost:3000'
}

// ---------------------------------------------------------------- passwords ---

/** Wrong passwords in a row before anybody has to wait. People mistype. */
export const FREE_ATTEMPTS = 5
/** The longest single wait. */
export const MAX_WAIT_MINUTES = 60
/**
 * Wrong passwords in a row after which password sign-in stops until a reset.
 * NIST 800-63B's ceiling; at an hour apart it takes days to reach.
 */
export const STOP_AFTER = 100

export interface Attempt {
  /** `succeeded` is any sign-in that worked, or a password being set. */
  outcome: 'failed' | 'succeeded'
  at: Date
}

export type AttemptVerdict =
  { ok: true } | { ok: false; stopped: boolean; seconds: number; why: string }

function spoken(seconds: number): string {
  if (seconds < 60) return seconds === 1 ? '1 second' : `${seconds} seconds`
  const minutes = Math.ceil(seconds / 60)
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

/**
 * Whether a password may be checked for this address right now.
 *
 * `history` is the address's recent attempts, newest first. Only the unbroken
 * run of failures at its head counts: anything that worked resets it.
 *
 * The first five wrong passwords cost nothing. From the fifth, each one
 * doubles the wait before the next is checked — a minute, two, four — up to
 * an hour, which holds a guesser to a couple of dozen tries a day. After a
 * hundred in a row, password sign-in stops until the password is reset.
 *
 * Nothing here needs an administrator to undo, and nothing here blocks the
 * emailed link. That is deliberate: a throttle anybody can trigger by typing a
 * colleague's address is also a way to lock that colleague out, and the link is
 * what keeps it from being one.
 *
 * Fails closed on a failure stamped in the future, unlike `mayRequestLink`: the
 * worst case there is one extra email, and here it is extra guesses.
 */
export function mayAttemptPassword(history: readonly Attempt[], now: Date): AttemptVerdict {
  let run = 0
  for (const a of history) {
    if (a.outcome !== 'failed') break
    run++
  }

  if (run >= STOP_AFTER) {
    return {
      ok: false,
      stopped: true,
      seconds: 0,
      why: 'Password sign-in for this address has been stopped after too many wrong passwords in a row. Reset the password by email to get back in.',
    }
  }

  if (run < FREE_ATTEMPTS) return { ok: true }

  const wait = Math.min(2 ** (run - FREE_ATTEMPTS), MAX_WAIT_MINUTES) * 60
  const elapsed = Math.max(0, (now.getTime() - history[0].at.getTime()) / 1000)
  if (elapsed >= wait) return { ok: true }

  const seconds = Math.ceil(wait - elapsed)
  return {
    ok: false,
    stopped: false,
    seconds,
    why: `Too many wrong passwords in a row for this address. Try again in ${spoken(seconds)}, or sign in with a link by email instead.`,
  }
}

// ----------------------------------------------------------------- sessions ---

/**
 * The hard limit on a session: a fresh sign-in at least every thirty days, as
 * NIST 800-63B asks, however much it is used. Without it a bar laptop that is
 * never switched off stays signed in as whoever used it last, indefinitely.
 */
export const SESSION_MAX_DAYS = 30

/**
 * The idle limit: a session nobody has used for a fortnight ends early. Long
 * enough that somebody who only works weekends stays signed in between shifts.
 */
export const SESSION_IDLE_DAYS = 14

/** How often use is written back. Hourly is plenty to measure a fortnight by. */
export const SESSION_TOUCH_MINUTES = 60

const DAY_MS = 24 * 60 * 60 * 1000

export type SessionState = 'live' | 'idle' | 'expired'

export function sessionState(s: { expires: Date; lastSeenAt: Date }, now: Date): SessionState {
  if (now.getTime() >= s.expires.getTime()) return 'expired'
  if (now.getTime() - s.lastSeenAt.getTime() >= SESSION_IDLE_DAYS * DAY_MS) return 'idle'
  return 'live'
}

/** When a session signed in at `at` must end regardless. */
export function sessionExpiry(at: Date): Date {
  return new Date(at.getTime() + SESSION_MAX_DAYS * DAY_MS)
}

export function shouldTouchSession(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= SESSION_TOUCH_MINUTES * 60 * 1000
}

/**
 * The session cookie's name and whether it is Secure.
 *
 * Over https it is `__Host-` prefixed, which makes the browser insist on
 * Secure, the whole site as its path, and this exact host — no subdomain can
 * plant or read it. Browsers refuse that over plain http, so the dev server
 * gets a plain name. The configured address decides, since that is what the
 * site is actually served on; production with none configured assumes https.
 */
export function sessionCookie(
  configured: string | undefined,
  nodeEnv: string | undefined,
): { name: string; secure: boolean } {
  const url = configured?.trim()
  const secure = url ? url.startsWith('https://') : nodeEnv === 'production'
  return { name: secure ? '__Host-pickle_session' : 'pickle_session', secure }
}
