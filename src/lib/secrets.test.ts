import { beforeEach, describe, expect, it } from 'vitest'
import { isConfigured, isSealed, keyFingerprint, open, seal, SEAL_VERSION } from './secrets'

/**
 * The sealing used for payment details.
 *
 * Everything here is deterministic except the IV, which must not be — the
 * first test in `sealing` is the one that matters most, because AES-GCM with
 * a repeated IV under one key leaks the plaintext.
 */

const KEY_A = Buffer.alloc(32, 7).toString('base64')
const KEY_B = Buffer.alloc(32, 9).toString('base64')

beforeEach(() => {
  process.env.PAYMENT_KEY = KEY_A
})

describe('sealing', () => {
  it('never produces the same ciphertext twice for the same plaintext', () => {
    const a = seal('0101230123456000')
    const b = seal('0101230123456000')
    expect(a.equals(b)).toBe(false)
  })

  it('round-trips', () => {
    expect(open(seal('0101230123456000'))).toBe('0101230123456000')
  })

  it('round-trips a name with characters outside ASCII', () => {
    expect(open(seal('Tāmati Kaipara-Ngātai'))).toBe('Tāmati Kaipara-Ngātai')
  })

  it('round-trips an empty string, which is not the same as absent', () => {
    expect(open(seal(''))).toBe('')
  })

  it('stamps a version byte so the format can change later', () => {
    expect(seal('x')[0]).toBe(SEAL_VERSION)
  })

  it('does not leave the plaintext anywhere in the ciphertext', () => {
    const sealed = seal('0101230123456000')
    expect(sealed.toString('latin1')).not.toContain('0101230123456000')
  })
})

describe('opening', () => {
  it('refuses a payload sealed under a different key', () => {
    const sealed = seal('0101230123456000')
    process.env.PAYMENT_KEY = KEY_B
    expect(() => open(sealed)).toThrow(/authentic/i)
  })

  it('refuses a payload whose ciphertext has been edited', () => {
    const sealed = seal('0101230123456000')
    // Flip a bit well past the version byte and IV.
    sealed[sealed.length - 20] ^= 0x01
    expect(() => open(sealed)).toThrow(/authentic/i)
  })

  it('refuses a payload whose auth tag has been edited', () => {
    const sealed = seal('0101230123456000')
    sealed[sealed.length - 1] ^= 0x01
    expect(() => open(sealed)).toThrow(/authentic/i)
  })

  it('refuses a payload written under a version it does not know', () => {
    const sealed = seal('0101230123456000')
    sealed[0] = 0xff
    expect(() => open(sealed)).toThrow(/version/i)
  })

  it('refuses a payload too short to contain an IV and a tag', () => {
    expect(() => open(Buffer.from([SEAL_VERSION, 1, 2, 3]))).toThrow(/too short/i)
  })
})

describe('the key', () => {
  it('is required — sealing without one fails loudly rather than storing plaintext', () => {
    delete process.env.PAYMENT_KEY
    expect(() => seal('0101230123456000')).toThrow(/PAYMENT_KEY/)
  })

  it('is rejected when it is not 32 bytes, rather than being padded to fit', () => {
    process.env.PAYMENT_KEY = Buffer.alloc(16, 1).toString('base64')
    expect(() => seal('x')).toThrow(/32 bytes/)
  })

  it('is rejected when it is not valid base64', () => {
    process.env.PAYMENT_KEY = 'not base64 at all!!'
    expect(() => seal('x')).toThrow(/base64|32 bytes/)
  })

  it('has a fingerprint that identifies it without revealing it', () => {
    const fp = keyFingerprint()
    expect(fp).toHaveLength(8)
    expect(KEY_A).not.toContain(fp)

    process.env.PAYMENT_KEY = KEY_B
    expect(keyFingerprint()).not.toBe(fp)
  })
})

describe('isConfigured', () => {
  it('is true with a usable key', () => {
    expect(isConfigured()).toBe(true)
  })

  it('is false with no key, rather than throwing', () => {
    delete process.env.PAYMENT_KEY
    expect(isConfigured()).toBe(false)
  })

  it('is false for a key of the wrong length', () => {
    process.env.PAYMENT_KEY = Buffer.alloc(8, 1).toString('base64')
    expect(isConfigured()).toBe(false)
  })
})

describe('isSealed', () => {
  it('recognises its own output', () => {
    expect(isSealed(seal('x'))).toBe(true)
  })

  it('does not mistake arbitrary bytes for a sealed payload', () => {
    expect(isSealed(Buffer.from('0101230123456000'))).toBe(false)
    expect(isSealed(Buffer.alloc(0))).toBe(false)
    expect(isSealed(null)).toBe(false)
  })
})
