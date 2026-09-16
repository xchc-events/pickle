import 'server-only'
import { headers } from 'next/headers'
import { db } from './db'
import { hashToken, mintToken, tokenLooksValid } from './grants'
import { hashPassword, needsRehash, verifyAgainstNothing, verifyPassword } from './password'
import { PASSWORD_MAX } from './password-policy'
import {
  STOP_AFTER,
  TOKEN_TTL_SECONDS,
  linkBase,
  mayAttemptPassword,
  sessionState,
  tokenState,
  type Attempt,
  type AttemptVerdict,
  type TokenState,
} from './auth-rules'
import type { AuthEventKind, AuthTokenPurpose, SignInMethod } from '@/generated/prisma/client'

/**
 * The database half of signing in.
 *
 * `auth-rules.ts` decides; this file carries the decision out against the
 * tables. The session cookie itself is `auth.ts`.
 *
 * Tokens here — emailed links and session cookies alike — follow the same
 * discipline as access grants, and use the same three helpers from
 * `grants.ts`: 32 bytes from the CSPRNG, only the SHA-256 kept, shape checked
 * before the database is asked anything.
 */

// ---------------------------------------------------------------- the trail ---

/**
 * Where a request came from, for the audit trail.
 *
 * The first `X-Forwarded-For` hop is whatever the proxy in front of the app
 * was told, which is only as trustworthy as that proxy. It is recorded for a
 * person reading the trail after something has gone wrong, and nothing
 * decides anything by it.
 */
async function origin(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null
  return { ip: ip?.slice(0, 64) ?? null, userAgent: h.get('user-agent')?.slice(0, 300) ?? null }
}

export async function recordAuthEvent(
  kind: AuthEventKind,
  who: { email: string; userId?: string | null; actorId?: string | null },
): Promise<void> {
  await db.authEvent.create({
    data: {
      kind,
      email: who.email,
      userId: who.userId ?? null,
      actorId: who.actorId ?? null,
      ...(await origin()),
    },
  })
}

// ---------------------------------------------------------------- passwords ---

/**
 * What resets the wrong-password count: anything that shows the owner got in
 * or took the password back. Asking for a link is not on the list — anybody
 * can ask for a link to anybody's address.
 */
const GOT_IN: AuthEventKind[] = [
  'PASSWORD_SIGN_IN',
  'LINK_SIGN_IN',
  'PASSWORD_SET',
  'PASSWORD_RESET',
  'PASSWORD_CHANGED',
]

/** The address's recent attempts, newest first — as many as the throttle can count. */
export async function passwordHistory(email: string): Promise<Attempt[]> {
  const rows = await db.authEvent.findMany({
    where: { email, kind: { in: ['PASSWORD_FAILED', ...GOT_IN] } },
    orderBy: { at: 'desc' },
    take: STOP_AFTER,
    select: { kind: true, at: true },
  })
  return rows.map((r) => ({
    outcome: r.kind === 'PASSWORD_FAILED' ? ('failed' as const) : ('succeeded' as const),
    at: r.at,
  }))
}

export type PasswordAttempt =
  | { ok: true; userId: string }
  | { ok: false; reason: 'wrong' | 'inactive' }
  | { ok: false; reason: 'throttled'; verdict: Extract<AttemptVerdict, { ok: false }> }

/**
 * Longer than any password the policy allows, with room for how a browser
 * might encode it. Anything past this cannot be right, so it is not hashed.
 */
const LONGEST_CANDIDATE = PASSWORD_MAX * 4

/**
 * Check a password for an address.
 *
 * Every path that reaches a check does the same amount of work — an address
 * with no account, or an account with no password, is checked against nothing
 * at the full cost — and gets the same answer, `wrong`. Only the right password
 * for a switched-off account learns that the account exists.
 */
export async function attemptPassword(
  email: string,
  password: string,
  now = new Date(),
): Promise<PasswordAttempt> {
  const verdict = mayAttemptPassword(await passwordHistory(email), now)
  if (!verdict.ok) return { ok: false, reason: 'throttled', verdict }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, active: true, passwordHash: true },
  })

  const checkable = user?.passwordHash && password.length <= LONGEST_CANDIDATE
  const right = checkable
    ? await verifyPassword(password, user.passwordHash!)
    : await verifyAgainstNothing(password.slice(0, LONGEST_CANDIDATE))

  if (!right || !user?.passwordHash) {
    await recordAuthEvent('PASSWORD_FAILED', { email, userId: user?.id ?? null })
    return { ok: false, reason: 'wrong' }
  }

  if (!user.active) {
    await recordAuthEvent('REFUSED_INACTIVE', { email, userId: user.id })
    return { ok: false, reason: 'inactive' }
  }

  // The only moment the password is in hand, so the only moment an old hash
  // can be brought up to the current cost.
  if (needsRehash(user.passwordHash)) {
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password) },
    })
  }

  await recordAuthEvent('PASSWORD_SIGN_IN', { email, userId: user.id })
  return { ok: true, userId: user.id }
}

/** The account an address belongs to, if any — for sending it a link. */
export async function accountByEmail(email: string) {
  return db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, active: true },
  })
}

/** What the account page and the password forms need to know about an account. */
export async function credentialsOf(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      firstName: true,
      lastName: true,
      active: true,
      passwordHash: true,
      passwordChangedAt: true,
    },
  })
}

/**
 * Put a new password on an account from inside it — the account page, where
 * the old password was just checked.
 *
 * The browser that did it stays signed in; every other session ends, and so
 * does any unspent link. If somebody else knew the old password, this is the
 * moment they lose what it gave them.
 */
export async function replacePassword(
  userId: string,
  passwordHash: string,
  keepSessionId: string,
  now = new Date(),
): Promise<void> {
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: now } }),
    db.session.deleteMany({ where: { userId, id: { not: keepSessionId } } }),
    db.authToken.deleteMany({ where: { userId, usedAt: null } }),
  ])
}

// -------------------------------------------------------------------- links ---

/**
 * Which unspent links a new one replaces. Invitations and resets are one
 * family — both set a password, and only the newest should work.
 */
const FAMILY: Record<AuthTokenPurpose, AuthTokenPurpose[]> = {
  SIGN_IN: ['SIGN_IN'],
  INVITE: ['INVITE', 'RESET'],
  RESET: ['INVITE', 'RESET'],
}

/** When the last emailed link of any kind went to this account. */
export async function lastLinkSentAt(userId: string): Promise<Date | null> {
  const row = await db.authToken.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  return row?.createdAt ?? null
}

export interface IssuedLink {
  url: string
  expires: Date
}

/**
 * Mint a link for an account. The token exists in readable form only in the
 * returned URL, which goes into an email and nowhere else.
 *
 * Null when there is nowhere safe to point it — see `linkBase`.
 */
export async function issueLink(
  userId: string,
  purpose: AuthTokenPurpose,
  now = new Date(),
): Promise<IssuedLink | null> {
  const base = linkBase(process.env.AUTH_URL, process.env.NODE_ENV)
  if (!base) return null

  const token = mintToken()
  const expires = new Date(now.getTime() + TOKEN_TTL_SECONDS[purpose] * 1000)

  await db.$transaction([
    db.authToken.deleteMany({
      where: {
        userId,
        // Replaced, and while here, anything long dead for this account.
        OR: [{ purpose: { in: FAMILY[purpose] }, usedAt: null }, { expires: { lt: now } }],
      },
    }),
    db.authToken.create({
      data: { tokenHash: hashToken(token), purpose, userId, expires, createdAt: now },
    }),
  ])

  return { url: `${base}/sign-in/link/${token}`, expires }
}

export interface LinkPreview {
  purpose: AuthTokenPurpose
  /** `inactive` when the link is fine but its account has been switched off. */
  state: TokenState | 'inactive'
  email: string
  /** Everything the account is called, for the password policy's context. */
  names: string[]
  hasPassword: boolean
}

/** Look at a link without spending it — for the page it lands on. */
export async function previewLink(token: string, now = new Date()): Promise<LinkPreview | null> {
  if (!tokenLooksValid(token)) return null

  const row = await db.authToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      purpose: true,
      expires: true,
      usedAt: true,
      user: {
        select: {
          email: true,
          name: true,
          firstName: true,
          lastName: true,
          active: true,
          passwordHash: true,
        },
      },
    },
  })
  if (!row) return null

  const state = tokenState(row, now)
  const { user } = row
  return {
    purpose: row.purpose,
    state: state === 'open' && !user.active ? 'inactive' : state,
    email: user.email,
    names: [user.name, user.firstName, user.lastName].filter((n): n is string => Boolean(n)),
    hasPassword: user.passwordHash !== null,
  }
}

/**
 * Spend a sign-in link.
 *
 * Checked and spent in one statement: the update only matches a row that is
 * unused, unexpired, a sign-in link and on an active account, so two requests
 * racing for one link cannot both get a session.
 */
export async function redeemSignInLink(
  token: string,
  now = new Date(),
): Promise<{ userId: string; email: string } | null> {
  if (!tokenLooksValid(token)) return null
  const tokenHash = hashToken(token)

  const spent = await db.authToken.updateMany({
    where: {
      tokenHash,
      usedAt: null,
      expires: { gt: now },
      purpose: 'SIGN_IN',
      user: { active: true },
    },
    data: { usedAt: now },
  })
  if (spent.count !== 1) return null

  const row = await db.authToken.findUnique({
    where: { tokenHash },
    select: { userId: true, user: { select: { email: true } } },
  })
  return row ? { userId: row.userId, email: row.user.email } : null
}

/** Thrown inside the transaction to roll it back when the link will not spend. */
class Unspendable extends Error {}

/**
 * Set a password from an invitation or reset link.
 *
 * One transaction: spend the link, write the hash, end every session the
 * account had, and kill every other unspent link. Nobody who was signed in on
 * the old password — or who was holding an older link — keeps anything.
 *
 * The hash is made by the caller before this is called, so the slow part
 * happens outside the transaction and a password the policy refuses never
 * spends the link.
 */
export async function setPasswordWithLink(
  token: string,
  passwordHash: string,
  now = new Date(),
): Promise<{ userId: string; email: string; purpose: AuthTokenPurpose } | null> {
  if (!tokenLooksValid(token)) return null
  const tokenHash = hashToken(token)

  try {
    return await db.$transaction(async (tx) => {
      const spent = await tx.authToken.updateMany({
        where: {
          tokenHash,
          usedAt: null,
          expires: { gt: now },
          purpose: { in: ['INVITE', 'RESET'] },
          user: { active: true },
        },
        data: { usedAt: now },
      })
      if (spent.count !== 1) throw new Unspendable()

      const row = await tx.authToken.findUnique({
        where: { tokenHash },
        select: { purpose: true, userId: true, user: { select: { email: true } } },
      })
      if (!row) throw new Unspendable()

      await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash, passwordChangedAt: now },
      })
      await tx.session.deleteMany({ where: { userId: row.userId } })
      await tx.authToken.deleteMany({ where: { userId: row.userId, usedAt: null } })

      return { userId: row.userId, email: row.user.email, purpose: row.purpose }
    })
  } catch (err) {
    if (err instanceof Unspendable) return null
    throw err
  }
}

// ----------------------------------------------------------------- sessions ---

export interface SessionRow {
  id: string
  method: SignInMethod
  userAgent: string | null
  createdAt: Date
  lastSeenAt: Date
}

/** An account's sessions that are still good, newest use first. */
export async function liveSessions(userId: string, now = new Date()): Promise<SessionRow[]> {
  const rows = await db.session.findMany({
    where: { userId, expires: { gt: now } },
    orderBy: { lastSeenAt: 'desc' },
    select: {
      id: true,
      method: true,
      userAgent: true,
      createdAt: true,
      lastSeenAt: true,
      expires: true,
    },
  })
  return rows
    .filter((r) => sessionState(r, now) === 'live')
    .map((r) => ({
      id: r.id,
      method: r.method,
      userAgent: r.userAgent,
      createdAt: r.createdAt,
      lastSeenAt: r.lastSeenAt,
    }))
}

/**
 * End one session. Scoped to its owner in the query, so a session id from
 * somebody else's account matches nothing rather than being checked after.
 */
export async function endSession(userId: string, sessionId: string): Promise<boolean> {
  const ended = await db.session.deleteMany({ where: { id: sessionId, userId } })
  return ended.count > 0
}

/** End an account's sessions — all of them, or all but the one asking. */
export async function endSessions(userId: string, opts: { except?: string } = {}): Promise<number> {
  const ended = await db.session.deleteMany({
    where: opts.except ? { userId, id: { not: opts.except } } : { userId },
  })
  return ended.count
}
