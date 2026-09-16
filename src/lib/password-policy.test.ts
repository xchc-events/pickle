import { describe, expect, it } from 'vitest'
import { PASSWORD_MAX, PASSWORD_MIN, checkPassword } from './password-policy'

/**
 * What counts as a good enough password.
 *
 * Follows NIST SP 800-63B rev. 4 rather than the rules people remember from
 * bank websites, because those rules are the ones that produce `Password1!`:
 *
 *  - **Length is the rule.** Fifteen characters, since a password is the only
 *    thing standing in front of an account here — there is no second factor.
 *  - **No composition rules.** No "one capital, one number, one symbol".
 *  - **Refuse the guessable**: the passwords everybody tries first, runs along
 *    the keyboard, one thing typed over and over, and anything built out of
 *    the person's own name, their email address or the venue's name.
 *
 * Every refusal is a sentence a person can act on, because the person reading
 * it is standing at a bar laptop trying to get into the roster.
 */

const who = { email: 'mere.tapu@xchc.co.nz', names: ['Mere Tapu'] }

const refused = (password: string, ctx = who) => {
  const v = checkPassword(password, ctx)
  return v.ok ? null : v.why
}

describe('checkPassword — length', () => {
  it('accepts a few ordinary words', () => {
    expect(checkPassword('kettle harbour mitten', who).ok).toBe(true)
  })

  it('refuses anything shorter than the minimum', () => {
    expect(refused('kettle harbour')).toMatch(new RegExp(String(PASSWORD_MIN)))
  })

  it('accepts exactly the minimum', () => {
    const fifteen = 'kettleharbourmi'
    expect(fifteen).toHaveLength(15)
    expect(checkPassword(fifteen, who).ok).toBe(true)
  })

  /**
   * Counted in characters a person typed, not UTF-16 units. An emoji is one
   * character on the keyboard and two in `String.length`; counting it as two
   * would let a shorter password through than the rule says.
   */
  it('counts characters, not UTF-16 code units', () => {
    const fourteenish = 'kettle harbo🦀' // 13 characters, 14 UTF-16 units
    expect(fourteenish.length).toBe(14)
    expect(checkPassword(fourteenish + '🦀', who).ok).toBe(false)
  })

  it('refuses a password longer than the maximum', () => {
    expect(refused('kettle harbour mitten '.repeat(10))).toMatch(new RegExp(String(PASSWORD_MAX)))
  })

  it('allows at least 64 characters, as NIST asks', () => {
    expect(PASSWORD_MAX).toBeGreaterThanOrEqual(64)
  })

  it('says spaces are fine, since that is how a long password gets easy', () => {
    expect(refused('short one')).toMatch(/words|spaces/i)
  })
})

describe('checkPassword — no composition rules', () => {
  it('does not ask for capitals, digits or symbols', () => {
    expect(checkPassword('kettle harbour mitten', who).ok).toBe(true)
  })

  it('accepts spaces, punctuation, macrons and emoji', () => {
    expect(checkPassword('kōrero ki te whānau 🦀!', who).ok).toBe(true)
  })
})

describe('checkPassword — repetition', () => {
  it('refuses one character over and over', () => {
    expect(refused('aaaaaaaaaaaaaaaa')).toMatch(/repeat/i)
  })

  it('refuses a short run typed over and over', () => {
    expect(refused('abcabcabcabcabcabc')).toMatch(/repeat/i)
    expect(refused('passwordpassword')).not.toBeNull()
  })

  it('sees the repetition through spaces and punctuation', () => {
    expect(refused('one two one two one two')).toMatch(/repeat/i)
  })

  it('does not mistake ordinary words for repetition', () => {
    expect(checkPassword('banana bandana cabana', who).ok).toBe(true)
  })
})

describe('checkPassword — runs along the keyboard or the alphabet', () => {
  it('refuses a row of the keyboard', () => {
    expect(refused('qwertyuiopasdfgh')).toMatch(/keyboard|sequence|run/i)
  })

  it('refuses counting', () => {
    expect(refused('123456789012345')).not.toBeNull()
    expect(refused('987654321098765')).not.toBeNull()
  })

  it('refuses the alphabet', () => {
    expect(refused('abcdefghijklmnopq')).toMatch(/keyboard|sequence|run/i)
  })

  it('refuses a walk down the keyboard columns', () => {
    expect(refused('1qaz2wsx3edc4rfv')).not.toBeNull()
  })

  it('allows a short run inside something longer', () => {
    expect(checkPassword('my old qwerty keyboard', who).ok).toBe(true)
  })
})

describe('checkPassword — built out of things an attacker already knows', () => {
  it('refuses the email address as the password', () => {
    expect(refused('mere.tapu@xchc.co.nz')).toMatch(/name|email|venue/i)
  })

  it('refuses the person’s name with a few digits on it', () => {
    expect(refused('MereTapu2026!!!!')).toMatch(/name|email|venue/i)
  })

  it('refuses the venue’s own name dressed up', () => {
    expect(refused('PicklePicklePickle1')).not.toBeNull()
    expect(refused('xchc christchurch 1')).toMatch(/name|email|venue/i)
  })

  it('refuses the words everybody tries first, padded to length', () => {
    expect(refused('password123456789')).toMatch(/tries first|name|email|venue/i)
    expect(refused('letmein letmein!!')).not.toBeNull()
  })

  it('allows a name inside a password that has plenty of its own', () => {
    expect(checkPassword('mere took the long way home', who).ok).toBe(true)
  })

  it('ignores context too short to mean anything', () => {
    // A two-letter local part would otherwise strip "jo" out of every
    // password with "jo" in it.
    expect(checkPassword('jolly kettle harbour', { email: 'jo@xchc.co.nz', names: [] }).ok).toBe(
      true,
    )
  })

  it('copes with no name at all', () => {
    expect(checkPassword('kettle harbour mitten', { email: 'awhina@koura.test' }).ok).toBe(true)
  })
})

describe('checkPassword — the famous ones', () => {
  it('refuses passwords off the well-known lists even when they are long', () => {
    expect(refused('correct horse battery staple')).toMatch(/common|known|tries first/i)
    expect(refused('Correct-Horse-Battery-Staple')).not.toBeNull()
  })
})

describe('checkPassword — substance', () => {
  it('refuses a password that is mostly spaces and punctuation', () => {
    expect(refused('a . b . c . d . e')).not.toBeNull()
    expect(refused('!!!!!!!!!!!!!!!!')).not.toBeNull()
  })
})

describe('checkPassword — wording', () => {
  it('always says why in a full sentence', () => {
    for (const p of ['short', 'aaaaaaaaaaaaaaaa', 'qwertyuiopasdfgh', 'mere.tapu@xchc.co.nz']) {
      expect(refused(p)).toMatch(/^[A-Z].*\.$/)
    }
  })

  it('never repeats the password back', () => {
    const p = 'MereTapu2026!!!!'
    expect(refused(p)).not.toContain(p)
  })
})
