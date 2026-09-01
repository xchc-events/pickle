import { describe, expect, it } from 'vitest'
import { mayAdmit, mayChangeRole, mayDeactivate, normaliseEmail, userProblems } from './auth-rules'

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
