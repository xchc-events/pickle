import { describe, expect, it } from 'vitest'
import { deviceOf } from './format'

/**
 * `deviceOf` names a session in somebody's own list of where they are signed
 * in. It only has to be recognisable — "Safari on a Mac" is enough to tell
 * the office laptop from a phone — and it never decides anything, because a
 * user agent is whatever the browser chose to say.
 */
describe('deviceOf', () => {
  const ua = {
    macSafari:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
    macChrome:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    winEdge:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
    iphone:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
    iphoneChrome:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
    android:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  }

  it('names the browser and the platform', () => {
    expect(deviceOf(ua.macSafari)).toBe('Safari on a Mac')
    expect(deviceOf(ua.macChrome)).toBe('Chrome on a Mac')
    expect(deviceOf(ua.linuxFirefox)).toBe('Firefox on Linux')
  })

  it('does not mistake Edge for the Chrome it is built on', () => {
    expect(deviceOf(ua.winEdge)).toBe('Edge on Windows')
  })

  it('knows a phone', () => {
    expect(deviceOf(ua.iphone)).toBe('Safari on an iPhone')
    expect(deviceOf(ua.iphoneChrome)).toBe('Chrome on an iPhone')
    expect(deviceOf(ua.android)).toBe('Chrome on Android')
  })

  it('says something honest when it cannot tell', () => {
    expect(deviceOf(null)).toBe('An unknown browser')
    expect(deviceOf('curl/8.7.1')).toBe('An unknown browser')
  })
})
