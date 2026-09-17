import { describe, expect, it } from 'vitest'
import { PASSWORD_MIN } from './password-policy'
import { seedOnlyIfEmpty, seedPasswordFrom } from './seed-install'

/**
 * The two deploy-time knobs the seed reads from the environment.
 *
 * Both are pure string-in, value-out functions with no database and no
 * `server-only` — `prisma/seed.ts` runs under `tsx`, outside Next.js, so
 * anything it depends on has to work there too. See prisma/seed.ts for how
 * the results are used: a thrown Error here must reach the process before a
 * single row is touched.
 */

const PEOPLE = [
  { name: 'Mere Tapu', email: 'mt@xchc.test' },
  { name: 'Sione Latu', email: 'sl@xchc.test' },
]

describe('seedPasswordFrom', () => {
  it('is null when SEED_PASSWORD is unset', () => {
    expect(seedPasswordFrom({}, PEOPLE)).toBeNull()
  })

  it('is null when SEED_PASSWORD is blank or only whitespace', () => {
    expect(seedPasswordFrom({ SEED_PASSWORD: '' }, PEOPLE)).toBeNull()
    expect(seedPasswordFrom({ SEED_PASSWORD: '   ' }, PEOPLE)).toBeNull()
  })

  it('returns the password, trimmed, once it passes the policy for everyone', () => {
    const password = seedPasswordFrom(
      { SEED_PASSWORD: '  Correct-Horse-Battery-Staple-2026  ' },
      PEOPLE,
    )
    expect(password).toBe('Correct-Horse-Battery-Staple-2026')
  })

  it('throws, naming the reason, for a password shorter than the house minimum', () => {
    expect(() => seedPasswordFrom({ SEED_PASSWORD: 'tiny-pw' }, PEOPLE)).toThrow(
      new RegExp(String(PASSWORD_MIN)),
    )
  })

  /**
   * The same candidate is checked against every seeded person, because the
   * same password goes on all of them — a password only long-time-friendly
   * with the first user in the list is not good enough for the second.
   */
  it('throws for a password built from a seeded user’s own name', () => {
    expect(() => seedPasswordFrom({ SEED_PASSWORD: 'Sione Latu 202601' }, PEOPLE)).toThrow(
      /name|email|venue/i,
    )
  })

  it('throws for a password built from the venue’s own name', () => {
    expect(() => seedPasswordFrom({ SEED_PASSWORD: 'xchc christchurch tix1' }, PEOPLE)).toThrow(
      /name|email|venue/i,
    )
  })

  it('never puts the password itself in the thrown message', () => {
    expect.assertions(1)
    try {
      seedPasswordFrom({ SEED_PASSWORD: 'tiny-pw' }, PEOPLE)
    } catch (err) {
      expect(String(err)).not.toContain('tiny-pw')
    }
  })

  it('names which address failed, so a bad SEED_PASSWORD is easy to fix', () => {
    expect(() => seedPasswordFrom({ SEED_PASSWORD: 'Sione Latu 202601' }, PEOPLE)).toThrow(
      /sl@xchc\.test/,
    )
  })
})

describe('seedOnlyIfEmpty', () => {
  it('is false when unset', () => {
    expect(seedOnlyIfEmpty({})).toBe(false)
  })

  it.each(['', '0', 'false'])('is false for %j', (value) => {
    expect(seedOnlyIfEmpty({ SEED_ONLY_IF_EMPTY: value })).toBe(false)
  })

  it.each(['1', 'true', 'TRUE'])('is true for %j', (value) => {
    expect(seedOnlyIfEmpty({ SEED_ONLY_IF_EMPTY: value })).toBe(true)
  })
})
