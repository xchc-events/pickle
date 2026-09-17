import { describe, expect, it } from 'vitest'
import {
  FREE_ATTEMPTS,
  LINK_COOLDOWN_SECONDS,
  MAX_WAIT_MINUTES,
  SESSION_IDLE_DAYS,
  SESSION_MAX_DAYS,
  STOP_AFTER,
  TOKEN_TTL_SECONDS,
  linkBase,
  mayAdmit,
  mayAttemptPassword,
  mayChangeRole,
  mayRequestLink,
  maySetActive,
  normaliseEmail,
  sessionCookie,
  sessionState,
  shouldTouchSession,
  tokenState,
  userProblems,
  type Attempt,
} from './auth-rules'

/**
 * Who gets in, and who is allowed to change that.
 *
 * Written before the implementation because this is the file that decides
 * whether a stranger with a Google account can read the venue's pipeline. The
 * rule that matters most is the first one: **there is no self-signup.** This
 * is one venue's internal tool, not a product with a sign-up page, and an
 * account exists because an administrator made it.
 */

describe('mayAdmit', () => {
  const known = { email: 'mere@xchc.co.nz', known: true, active: true }

  it('lets in somebody an administrator has already added', () => {
    expect(mayAdmit(known).ok).toBe(true)
  })

  it('refuses an email with no account — there is no self-signup', () => {
    const v = mayAdmit({ ...known, known: false })
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.code).toBe('unknown')
  })

  it('refuses somebody who has been deactivated', () => {
    const v = mayAdmit({ ...known, active: false })
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.code).toBe('inactive')
  })

  it('refuses a deactivated account before it worries about anything else', () => {
    expect(mayAdmit({ ...known, known: true, active: false }).ok).toBe(false)
  })

  it('says why in words a person could act on', () => {
    const v = mayAdmit({ ...known, known: false })
    expect(v.ok === false && v.why).toMatch(/administrator|added|account/i)
  })
})

describe('normaliseEmail', () => {
  it('lowercases, because providers do not agree on case', () => {
    expect(normaliseEmail('Mere@XCHC.co.nz')).toBe('mere@xchc.co.nz')
  })

  it('trims', () => {
    expect(normaliseEmail('  mere@xchc.co.nz ')).toBe('mere@xchc.co.nz')
  })

  it('leaves the local part otherwise alone — dots are not ours to strip', () => {
    // Gmail ignores dots; most providers do not. Stripping them would merge
    // two people who are not the same person.
    expect(normaliseEmail('first.last@xchc.co.nz')).toBe('first.last@xchc.co.nz')
  })
})

describe('maySetActive', () => {
  const actor = { id: 'u1', role: 'ADMIN' as const }
  const nonAdmins = ['COORDINATOR', 'DESIGN', 'TECH', 'BAR', 'PROMOTER'] as const

  describe('switching somebody off', () => {
    const other = { id: 'u2', role: 'COORDINATOR' as const, active: true }

    it('lets an admin switch off somebody else', () => {
      expect(maySetActive(actor, other, false, 2).ok).toBe(true)
    })

    it('refuses to let somebody switch themselves off', () => {
      const v = maySetActive(actor, { id: 'u1', role: 'ADMIN', active: true }, false, 2)
      expect(v.ok).toBe(false)
      expect(v.ok === false && v.why).toMatch(/yourself|your own/i)
    })

    it('refuses to remove the last remaining admin', () => {
      const v = maySetActive(
        { id: 'u9', role: 'ADMIN' },
        { id: 'u2', role: 'ADMIN', active: true },
        false,
        1,
      )
      expect(v.ok).toBe(false)
      expect(v.ok === false && v.why).toMatch(/last|only|locked out/i)
    })

    it('allows removing an admin while another remains', () => {
      expect(
        maySetActive(
          { id: 'u9', role: 'ADMIN' },
          { id: 'u2', role: 'ADMIN', active: true },
          false,
          2,
        ).ok,
      ).toBe(true)
    })

    it.each(nonAdmins)('refuses a %s, even one whose role can open Admin', (role) => {
      const v = maySetActive({ id: 'u3', role }, other, false, 2)
      expect(v.ok).toBe(false)
      expect(v.ok === false && v.why).toMatch(/admin/i)
    })

    it('does not count an already-inactive account against the admin floor', () => {
      // Switching off an account that is already off is a no-op, not a
      // lockout risk.
      expect(maySetActive(actor, { id: 'u2', role: 'ADMIN', active: false }, false, 1).ok).toBe(
        true,
      )
    })
  })

  /**
   * Switching somebody back on hands their access back, which is as much a
   * decision about who has access as taking it away. The Admin module can be
   * granted to any role, and without this a coordinator who had been given
   * it could quietly undo an administrator's switch-off.
   */
  describe('switching somebody back on', () => {
    const off = { id: 'u2', role: 'COORDINATOR' as const, active: false }

    it('lets an admin switch somebody back on', () => {
      expect(maySetActive(actor, off, true, 2).ok).toBe(true)
    })

    it.each(nonAdmins)('refuses a %s, even one whose role can open Admin', (role) => {
      const v = maySetActive({ id: 'u3', role }, off, true, 2)
      expect(v.ok).toBe(false)
      expect(v.ok === false && v.why).toMatch(/admin/i)
    })

    it('lets the only admin switch another admin back on — that adds one, it loses none', () => {
      expect(maySetActive(actor, { id: 'u2', role: 'ADMIN', active: false }, true, 1).ok).toBe(true)
    })
  })
})

describe('mayChangeRole', () => {
  const actor = { id: 'u1', role: 'ADMIN' as const }

  it('lets an admin set somebody else’s role', () => {
    expect(mayChangeRole(actor, { id: 'u2', role: 'BAR', active: true }, 'TECH', 2).ok).toBe(true)
  })

  it('refuses to demote the last admin', () => {
    const v = mayChangeRole(actor, { id: 'u1', role: 'ADMIN', active: true }, 'BAR', 1)
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.why).toMatch(/last|only|locked out/i)
  })

  it('lets an admin demote themselves when another admin remains', () => {
    expect(mayChangeRole(actor, { id: 'u1', role: 'ADMIN', active: true }, 'BAR', 2).ok).toBe(true)
  })

  it('refuses a non-admin', () => {
    expect(
      mayChangeRole({ id: 'u3', role: 'TECH' }, { id: 'u2', role: 'BAR', active: true }, 'ADMIN', 2)
        .ok,
    ).toBe(false)
  })

  it('is fine promoting somebody to admin — that only adds one', () => {
    expect(mayChangeRole(actor, { id: 'u2', role: 'BAR', active: true }, 'ADMIN', 1).ok).toBe(true)
  })
})

describe('userProblems', () => {
  it('is silent for a well-formed staff account', () => {
    expect(userProblems({ role: 'TECH', organisationId: null, personId: 'p1' })).toEqual([])
  })

  /**
   * An external user with no organisation matches no events at all — see
   * `eventScope` in scope.ts, which returns nothing rather than everything.
   * That is safe, and it is also useless, so it is worth saying out loud.
   */
  it('flags a promoter with no organisation — they would see nothing', () => {
    expect(userProblems({ role: 'PROMOTER', organisationId: null, personId: null })).toContainEqual(
      expect.stringMatching(/organisation|promoter/i),
    )
  })

  it('flags an internal account with no person record', () => {
    expect(userProblems({ role: 'TECH', organisationId: null, personId: null })).toContainEqual(
      expect.stringMatching(/person|hours|roster/i),
    )
  })

  it('does not ask a promoter for a person record — they are not staff', () => {
    expect(userProblems({ role: 'PROMOTER', organisationId: 'org_koura', personId: null })).toEqual(
      [],
    )
  })

  it('flags a staff account that carries a promoter organisation', () => {
    expect(
      userProblems({ role: 'TECH', organisationId: 'org_koura', personId: 'p1' }),
    ).toContainEqual(expect.stringMatching(/staff|internal|organisation/i))
  })
})

describe('mayRequestLink', () => {
  const now = new Date('2026-09-02T12:00:00Z')
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000)

  /**
   * Sign-in links cost real emails. Resend's free tier is a hundred a day,
   * so an unthrottled form lets anybody type a colleague's address on repeat
   * and exhaust the venue's quota — which locks out the people who actually
   * need to sign in. The throttle is about availability, not about secrecy.
   */
  it('lets a first request through', () => {
    expect(mayRequestLink(null, now).ok).toBe(true)
  })

  it('lets a request through once the cooldown has passed', () => {
    expect(mayRequestLink(ago(LINK_COOLDOWN_SECONDS + 1), now).ok).toBe(true)
  })

  it('refuses a second request inside the cooldown', () => {
    const v = mayRequestLink(ago(5), now)
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.why).toMatch(/already|moment|wait|sent/i)
  })

  it('says how long is left, so the wait is not a mystery', () => {
    const v = mayRequestLink(ago(10), now)
    expect(v.ok === false && v.why).toMatch(new RegExp(String(LINK_COOLDOWN_SECONDS - 10)))
  })

  it('treats the boundary as through rather than blocked', () => {
    expect(mayRequestLink(ago(LINK_COOLDOWN_SECONDS), now).ok).toBe(true)
  })

  /**
   * A clock that has gone backwards, or a row written by a machine whose
   * time is off. Refusing forever would be the wrong failure — somebody
   * would be locked out with no way to explain it — so a future timestamp
   * is treated as no timestamp.
   */
  it('does not lock somebody out over a timestamp in the future', () => {
    expect(mayRequestLink(new Date(now.getTime() + 60_000), now).ok).toBe(true)
  })

  it('is short enough not to annoy a real person', () => {
    expect(LINK_COOLDOWN_SECONDS).toBeLessThanOrEqual(120)
  })
})

// ---------------------------------------------------------------- passwords ---

describe('mayAttemptPassword', () => {
  const now = new Date('2026-09-16T12:00:00Z')
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000)

  /** `n` wrong passwords, newest first, the latest `latest` seconds ago. */
  const wrong = (n: number, latest = 0): Attempt[] =>
    Array.from({ length: n }, (_, i) => ({ outcome: 'failed' as const, at: ago(latest + i) }))
  const right = (secondsAgo: number): Attempt => ({ outcome: 'succeeded', at: ago(secondsAgo) })

  /**
   * The wrong-password throttle is what makes guessing a password online
   * slow. It is counted per address, not per account, so an address with no
   * account is throttled exactly like one with an account — otherwise the
   * throttle itself would say which addresses are on file.
   *
   * It is a wait, not a lock that needs an administrator. Somebody who
   * cannot wait can always sign in with an emailed link, which is also what
   * stops a stranger locking a colleague out by typing their address wrongly
   * on purpose.
   */
  it('lets a first attempt through', () => {
    expect(mayAttemptPassword([], now).ok).toBe(true)
  })

  it('does not slow down the first few mistakes — people mistype', () => {
    expect(mayAttemptPassword(wrong(FREE_ATTEMPTS - 1), now).ok).toBe(true)
  })

  it('makes somebody wait a minute after five wrong passwords in a row', () => {
    const v = mayAttemptPassword(wrong(FREE_ATTEMPTS), now)
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.seconds).toBe(60)
  })

  it('doubles the wait with each wrong password after that', () => {
    const seconds = (n: number) => {
      const v = mayAttemptPassword(wrong(n), now)
      return v.ok ? 0 : v.seconds
    }
    expect(seconds(FREE_ATTEMPTS + 1)).toBe(120)
    expect(seconds(FREE_ATTEMPTS + 2)).toBe(240)
    expect(seconds(FREE_ATTEMPTS + 3)).toBe(480)
  })

  it('never makes anybody wait longer than an hour', () => {
    const v = mayAttemptPassword(wrong(40), now)
    expect(v.ok === false && v.seconds).toBe(MAX_WAIT_MINUTES * 60)
  })

  it('counts the wait from the most recent wrong password', () => {
    const v = mayAttemptPassword(wrong(FREE_ATTEMPTS, 45), now)
    expect(v.ok === false && v.seconds).toBe(15)
  })

  it('lets them try again once the wait is over', () => {
    expect(mayAttemptPassword(wrong(FREE_ATTEMPTS, 60), now).ok).toBe(true)
  })

  it('forgets every wrong password from before a sign-in that worked', () => {
    const history = [...wrong(2), right(10), ...wrong(30, 11)]
    expect(mayAttemptPassword(history, now).ok).toBe(true)
  })

  it('offers the email link rather than only saying no', () => {
    const v = mayAttemptPassword(wrong(FREE_ATTEMPTS), now)
    expect(v.ok === false && v.why).toMatch(/email|link/i)
    expect(v.ok === false && v.why).toMatch(/1 minute/)
  })

  /**
   * NIST 800-63B caps consecutive failures on one account at a hundred. At
   * an hour apart that takes days to reach, so anybody who gets there is
   * not a person who forgot — and the account is safe from further guessing
   * until its owner resets the password from their own inbox.
   */
  it('stops password sign-in outright after a hundred wrong passwords in a row', () => {
    const v = mayAttemptPassword(wrong(STOP_AFTER, 7 * 24 * 3600), now)
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.stopped).toBe(true)
    expect(v.ok === false && v.why).toMatch(/reset/i)
  })

  it('lifts the stop once the password has been reset', () => {
    const history = [right(5), ...wrong(STOP_AFTER, 6)]
    expect(mayAttemptPassword(history, now).ok).toBe(true)
  })

  /**
   * Unlike the link cooldown, this fails closed on a timestamp from the
   * future. The link cooldown guards a quota, where the worst case of
   * failing open is one extra email; this guards against guessing, where
   * the worst case is an attacker's clock trick buying extra guesses. The
   * person on the other end still has the email link.
   */
  it('does not let a failure stamped in the future cut the wait short', () => {
    const future = wrong(FREE_ATTEMPTS).map((a) => ({
      ...a,
      at: new Date(now.getTime() + 3600_000),
    }))
    const v = mayAttemptPassword(future, now)
    expect(v.ok === false && v.seconds).toBe(60)
  })
})

// ----------------------------------------------------------------- sessions ---

describe('sessionState', () => {
  const now = new Date('2026-09-16T12:00:00Z')
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 3600 * 1000)
  const session = (createdDaysAgo: number, seenDaysAgo: number) => ({
    expires: new Date(daysAgo(createdDaysAgo).getTime() + SESSION_MAX_DAYS * 24 * 3600 * 1000),
    lastSeenAt: daysAgo(seenDaysAgo),
  })

  it('is live inside both limits', () => {
    expect(sessionState(session(3, 0), now)).toBe('live')
  })

  /**
   * NIST 800-63B asks for a fresh sign-in at least every thirty days, however
   * the session is used. A bar laptop that is never switched off would
   * otherwise stay signed in as whoever last used it, forever.
   */
  it('ends thirty days after sign-in however much it is used', () => {
    expect(sessionState(session(SESSION_MAX_DAYS, 0), now)).toBe('expired')
  })

  it('ends sooner when nobody has used it for a fortnight', () => {
    expect(sessionState(session(SESSION_IDLE_DAYS + 1, SESSION_IDLE_DAYS), now)).toBe('idle')
  })

  it('is fine unused for most of a fortnight — somebody who only works weekends', () => {
    expect(sessionState(session(12, 12), now)).toBe('live')
  })

  it('does not end a session over a last-seen time in the future', () => {
    expect(sessionState(session(1, -1), now)).toBe('live')
  })

  it('has an idle limit shorter than its hard limit, or the idle limit means nothing', () => {
    expect(SESSION_IDLE_DAYS).toBeLessThan(SESSION_MAX_DAYS)
  })
})

describe('shouldTouchSession', () => {
  const now = new Date('2026-09-16T12:00:00Z')
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000)

  it('does not write to the database on every request', () => {
    expect(shouldTouchSession(minutesAgo(5), now)).toBe(false)
  })

  it('records use about hourly, which is plenty to measure a fortnight by', () => {
    expect(shouldTouchSession(minutesAgo(61), now)).toBe(true)
  })
})

// --------------------------------------------------------------- email links ---

describe('tokenState', () => {
  const now = new Date('2026-09-16T12:00:00Z')

  it('is open until it expires', () => {
    expect(tokenState({ expires: new Date(now.getTime() + 1000), usedAt: null }, now)).toBe('open')
  })

  it('is spent once used, even before it would have expired', () => {
    expect(tokenState({ expires: new Date(now.getTime() + 1000), usedAt: now }, now)).toBe('used')
  })

  it('treats the moment of expiry as expired', () => {
    expect(tokenState({ expires: now, usedAt: null }, now)).toBe('expired')
  })
})

describe('TOKEN_TTL_SECONDS', () => {
  it('gives a sign-in link and a reset link an hour', () => {
    expect(TOKEN_TTL_SECONDS.SIGN_IN).toBe(3600)
    expect(TOKEN_TTL_SECONDS.RESET).toBe(3600)
  })

  it('gives an invitation a week, because it waits for somebody who has not started yet', () => {
    expect(TOKEN_TTL_SECONDS.INVITE).toBe(7 * 24 * 3600)
  })
})

describe('linkBase', () => {
  /**
   * Links in emails are built from configuration and never from the request.
   * A reset link built from the Host header can be pointed at somebody
   * else's server by whoever sends the request — "password reset poisoning"
   * — and the victim's own click hands their token over.
   */
  it('uses the configured address, without a trailing slash', () => {
    expect(linkBase('https://pickle.minim.nz/', 'production')).toBe('https://pickle.minim.nz')
  })

  it('falls back to the dev server outside production', () => {
    expect(linkBase(undefined, 'development')).toBe('http://localhost:3000')
  })

  it('refuses to guess in production — a link to localhost is a link to nowhere', () => {
    expect(linkBase(undefined, 'production')).toBeNull()
    expect(linkBase('', 'production')).toBeNull()
  })
})

describe('sessionCookie', () => {
  /**
   * `__Host-` means the browser will only accept the cookie over https, for
   * the whole site and this exact host — no subdomain can set or read it.
   * Browsers refuse that over plain http, so the dev server needs a plain
   * name.
   */
  it('is a __Host- cookie, Secure, when the site is served over https', () => {
    expect(sessionCookie('https://pickle.minim.nz', 'production')).toEqual({
      name: '__Host-pickle_session',
      secure: true,
    })
  })

  it('is a plain cookie on http://localhost', () => {
    expect(sessionCookie('http://localhost:3000', 'development')).toEqual({
      name: 'pickle_session',
      secure: false,
    })
  })

  it('assumes https in production when no address is configured', () => {
    expect(sessionCookie(undefined, 'production').secure).toBe(true)
  })

  it('follows the configured address over the environment', () => {
    expect(sessionCookie('http://localhost:3000', 'production').secure).toBe(false)
  })
})
