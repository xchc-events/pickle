import { describe, expect, it } from 'vitest'
import {
  LINK_COOLDOWN_SECONDS,
  mayAdmit,
  mayChangeRole,
  mayDeactivate,
  mayRequestLink,
  normaliseEmail,
  userProblems,
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

describe('mayDeactivate', () => {
  const actor = { id: 'u1', role: 'ADMIN' as const }
  const other = { id: 'u2', role: 'COORDINATOR' as const, active: true }

  it('lets an admin deactivate somebody else', () => {
    expect(mayDeactivate(actor, other, 2).ok).toBe(true)
  })

  it('refuses to let somebody deactivate themselves', () => {
    const v = mayDeactivate(actor, { id: 'u1', role: 'ADMIN', active: true }, 2)
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.why).toMatch(/yourself|your own/i)
  })

  it('refuses to remove the last remaining admin', () => {
    const v = mayDeactivate(
      { id: 'u9', role: 'ADMIN' },
      { id: 'u2', role: 'ADMIN', active: true },
      1,
    )
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.why).toMatch(/last|only|locked out/i)
  })

  it('allows removing an admin while another remains', () => {
    expect(
      mayDeactivate({ id: 'u9', role: 'ADMIN' }, { id: 'u2', role: 'ADMIN', active: true }, 2).ok,
    ).toBe(true)
  })

  it('refuses somebody who is not an admin', () => {
    const v = mayDeactivate({ id: 'u3', role: 'COORDINATOR' }, other, 2)
    expect(v.ok).toBe(false)
    expect(v.ok === false && v.why).toMatch(/admin/i)
  })

  it('does not count an already-inactive account against the admin floor', () => {
    // Reactivating is never dangerous; deactivating something already off is
    // a no-op rather than a lockout risk.
    expect(mayDeactivate(actor, { id: 'u2', role: 'ADMIN', active: false }, 1).ok).toBe(true)
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
    expect(userProblems({ role: 'TECH', promoter: null, personId: 'p1' })).toEqual([])
  })

  /**
   * An external user with no organisation matches no events at all — see
   * `eventScope` in scope.ts, which returns nothing rather than everything.
   * That is safe, and it is also useless, so it is worth saying out loud.
   */
  it('flags a promoter with no organisation — they would see nothing', () => {
    expect(userProblems({ role: 'PROMOTER', promoter: null, personId: null })).toContainEqual(
      expect.stringMatching(/organisation|promoter/i),
    )
  })

  it('flags an internal account with no person record', () => {
    expect(userProblems({ role: 'TECH', promoter: null, personId: null })).toContainEqual(
      expect.stringMatching(/person|hours|roster/i),
    )
  })

  it('does not ask a promoter for a person record — they are not staff', () => {
    expect(userProblems({ role: 'PROMOTER', promoter: 'Kōura Records', personId: null })).toEqual(
      [],
    )
  })

  it('flags a staff account that carries a promoter organisation', () => {
    expect(
      userProblems({ role: 'TECH', promoter: 'Kōura Records', personId: 'p1' }),
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
