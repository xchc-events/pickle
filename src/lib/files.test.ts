import { describe, expect, it } from 'vitest'
import {
  MAX_BYTES,
  displayName,
  extensionOf,
  isAllowedMime,
  isWithinSize,
  objectKey,
  rejectionFor,
} from './files'

/**
 * What is allowed into the bucket, and under what name.
 *
 * Two of these tests are the security boundary rather than a convenience:
 * `objectKey` must never let an uploader's filename reach the key, and SVG
 * must never arrive from outside the venue. Both are the kind of thing that
 * looks fine on screen right up until it isn't.
 */

describe('object keys', () => {
  it('never contains any part of the uploader filename', () => {
    // The prefix is ours, from the kind. Only the last segment could carry
    // anything the uploader chose, so that is what this asserts against.
    const leaf = objectKey('RIDER_TECH', 'evt_123', 'my rider FINAL v2.pdf').split('/').pop()!
    expect(leaf).toBe(leaf.toLowerCase())
    expect(leaf).not.toContain('rider')
    expect(leaf).not.toContain('final')
    expect(leaf).not.toContain(' ')
    expect(leaf).toMatch(/^[a-f0-9]{32}\.pdf$/)
  })

  it('cannot be walked out of its prefix by a crafted filename', () => {
    const key = objectKey('RIDER_TECH', 'evt_123', '../../../etc/passwd')
    expect(key).not.toContain('..')
    expect(key.startsWith('rider-tech/evt_123/')).toBe(true)
  })

  it('ignores a filename trying to smuggle a slash', () => {
    const key = objectKey('PRESS_SHOT', 'pay_9', 'a/b/c.jpg')
    expect(key.split('/')).toHaveLength(3)
  })

  it('keeps the extension, because it is what makes the file open', () => {
    expect(objectKey('RIDER_TECH', 'evt_1', 'rider.pdf').endsWith('.pdf')).toBe(true)
    expect(objectKey('PRESS_SHOT', 'evt_1', 'shot.JPEG').endsWith('.jpeg')).toBe(true)
  })

  it('does not invent an extension when the filename has none', () => {
    expect(objectKey('OTHER', 'evt_1', 'README')).toMatch(/\/[a-z0-9]+$/)
  })

  it('is different every time, so one upload never overwrites another', () => {
    const a = objectKey('RIDER_TECH', 'evt_1', 'rider.pdf')
    const b = objectKey('RIDER_TECH', 'evt_1', 'rider.pdf')
    expect(a).not.toBe(b)
  })

  it('files by kind and owner, so a prefix listing is a meaningful set', () => {
    expect(objectKey('ARTWORK', 'evt_7', 'poster.pdf').startsWith('artwork/evt_7/')).toBe(true)
  })
})

describe('extensions', () => {
  it('lowercases', () => {
    expect(extensionOf('SHOT.JPG')).toBe('.jpg')
  })

  it('takes only the last one', () => {
    expect(extensionOf('rider.pdf.exe')).toBe('.exe')
  })

  it('is empty for a name with no extension', () => {
    expect(extensionOf('README')).toBe('')
  })

  it('is empty for a dotfile, which has no extension', () => {
    expect(extensionOf('.env')).toBe('')
  })

  it('rejects an extension long enough to be something other than one', () => {
    expect(extensionOf('a.' + 'x'.repeat(40))).toBe('')
  })
})

describe('what each kind accepts', () => {
  it('takes documents for riders', () => {
    expect(isAllowedMime('RIDER_TECH', 'application/pdf')).toBe(true)
    expect(isAllowedMime('RIDER_HOSPITALITY', 'application/pdf')).toBe(true)
  })

  it('does not take an executable dressed as a rider', () => {
    expect(isAllowedMime('RIDER_TECH', 'application/x-msdownload')).toBe(false)
    expect(isAllowedMime('RIDER_TECH', 'application/octet-stream')).toBe(false)
  })

  it('takes stills and video for artwork', () => {
    expect(isAllowedMime('ARTWORK', 'image/jpeg')).toBe(true)
    expect(isAllowedMime('ARTWORK', 'video/mp4')).toBe(true)
  })

  it('does not take video for a press shot', () => {
    expect(isAllowedMime('PRESS_SHOT', 'video/mp4')).toBe(false)
  })

  /**
   * An SVG is a document that can carry script. Served from an origin that
   * shares anything with the app, it is stored XSS. The venue's own marks
   * still need to be SVG, so the kind is the line: BRAND is uploaded by
   * staff, and no grant can write to it.
   */
  it('takes SVG only for the venue brand', () => {
    expect(isAllowedMime('BRAND', 'image/svg+xml')).toBe(true)
    expect(isAllowedMime('ARTWORK', 'image/svg+xml')).toBe(false)
    expect(isAllowedMime('PRESS_SHOT', 'image/svg+xml')).toBe(false)
    expect(isAllowedMime('EPK', 'image/svg+xml')).toBe(false)
  })

  it('ignores parameters and casing on the mime type', () => {
    expect(isAllowedMime('RIDER_TECH', 'application/PDF; charset=binary')).toBe(true)
  })

  it('takes nothing for a mime type it does not know', () => {
    expect(isAllowedMime('RIDER_TECH', '')).toBe(false)
    expect(isAllowedMime('RIDER_TECH', 'not/a-real-type')).toBe(false)
  })
})

describe('size limits', () => {
  it('lets a print poster through but not an unbounded one', () => {
    expect(isWithinSize('ARTWORK', 200 * 1024 * 1024)).toBe(true)
    expect(isWithinSize('ARTWORK', MAX_BYTES.ARTWORK + 1)).toBe(false)
  })

  it('holds riders to something a person would actually send', () => {
    expect(isWithinSize('RIDER_TECH', 5 * 1024 * 1024)).toBe(true)
    expect(isWithinSize('RIDER_TECH', 100 * 1024 * 1024)).toBe(false)
  })

  it('rejects an empty file rather than storing a zero-byte rider', () => {
    expect(isWithinSize('RIDER_TECH', 0)).toBe(false)
  })

  it('rejects a negative size', () => {
    expect(isWithinSize('RIDER_TECH', -1)).toBe(false)
  })
})

describe('display names', () => {
  it('keeps the name the uploader gave it', () => {
    expect(displayName('Tech rider — Static Bloom.pdf')).toBe('Tech rider — Static Bloom.pdf')
  })

  it('strips any path the browser included', () => {
    expect(displayName('C:\\Users\\bev\\rider.pdf')).toBe('rider.pdf')
    expect(displayName('/home/bev/rider.pdf')).toBe('rider.pdf')
  })

  it('strips control characters that would break a header', () => {
    expect(displayName('rider\r\nX-Injected: 1.pdf')).toBe('riderX-Injected: 1.pdf')
  })

  it('falls back rather than returning an empty name', () => {
    expect(displayName('')).toBe('Untitled')
    expect(displayName('///')).toBe('Untitled')
  })

  it('truncates a name long enough to be a problem', () => {
    expect(displayName('a'.repeat(500)).length).toBeLessThanOrEqual(200)
  })
})

describe('rejectionFor', () => {
  it('says nothing when the upload is fine', () => {
    expect(rejectionFor('RIDER_TECH', 'application/pdf', 1024)).toBeNull()
  })

  it('names the type when it is the type that is wrong', () => {
    expect(rejectionFor('RIDER_TECH', 'video/mp4', 1024)).toMatch(/PDF|type|accept/i)
  })

  it('names the size when it is the size that is wrong', () => {
    expect(rejectionFor('RIDER_TECH', 'application/pdf', 999 * 1024 * 1024)).toMatch(/M[Bb]|large/)
  })

  it('complains about the type first — it is the one that matters', () => {
    expect(rejectionFor('RIDER_TECH', 'video/mp4', 999 * 1024 * 1024)).toMatch(/type|accept|PDF/i)
  })
})
