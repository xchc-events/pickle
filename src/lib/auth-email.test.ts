import { describe, expect, it } from 'vitest'
import {
  inviteEmail,
  passwordChangedEmail,
  resetEmail,
  signInLinkEmail,
  type Mail,
} from './auth-email'

/**
 * The emails sign-in sends.
 *
 * Each one carries a credential or warns about one, so the things tested are
 * the things that go wrong quietly: a link that is not in the plain-text part,
 * a lifetime in the copy that disagrees with the token's, and a name typed in
 * Admin that turns into markup in somebody's inbox.
 */

const url = 'https://pickle.minim.nz/sign-in/link/abc123?x=1&y=2'

const all: [string, Mail][] = [
  ['sign-in link', signInLinkEmail(url)],
  ['invitation', inviteEmail({ url, name: 'Mere Tapu' })],
  ['reset', resetEmail(url)],
]

describe.each(all)('%s', (_, mail) => {
  it('puts the link in the plain-text part, for mail clients that show nothing else', () => {
    expect(mail.text).toContain(url)
  })

  it('escapes the link inside the HTML attribute', () => {
    expect(mail.html).toContain('href="https://pickle.minim.nz/sign-in/link/abc123?x=1&amp;y=2"')
  })

  it('says the link works once', () => {
    expect(mail.text).toMatch(/works once/i)
  })

  it('has a subject that names the product, so it is recognisable in a list', () => {
    expect(mail.subject).toMatch(/PicklePicklePickle/)
  })

  it('has no markup in the plain-text part', () => {
    expect(mail.text).not.toMatch(/<[a-z]/i)
  })
})

describe('lifetimes in the copy', () => {
  it('tells a sign-in link and a reset link they last an hour', () => {
    expect(signInLinkEmail(url).text).toMatch(/an hour/)
    expect(resetEmail(url).text).toMatch(/an hour/)
  })

  it('tells an invitation it lasts a week', () => {
    expect(inviteEmail({ url, name: null }).text).toMatch(/7 days/)
  })
})

describe('inviteEmail', () => {
  it('greets somebody by name when there is one', () => {
    expect(inviteEmail({ url, name: 'Mere Tapu' }).text).toMatch(/Kia ora Mere/)
  })

  it('still reads when there is no name', () => {
    expect(inviteEmail({ url, name: null }).text).toMatch(/^Kia ora,/m)
  })

  /** A name is typed by staff in Admin, and HTML email renders what it is given. */
  it('escapes a name before it goes anywhere near the HTML', () => {
    const mail = inviteEmail({ url, name: '<img src=x onerror=alert(1)> Tapu' })
    expect(mail.html).not.toContain('<img src=x')
    expect(mail.html).toContain('&lt;img')
  })

  it('says what to do: choose a password', () => {
    expect(inviteEmail({ url, name: null }).text).toMatch(/password/i)
  })
})

describe('resetEmail', () => {
  it('reassures somebody who did not ask for it that nothing has changed', () => {
    expect(resetEmail(url).text).toMatch(/did not ask/i)
    expect(resetEmail(url).text).toMatch(/not changed|has not changed|still works/i)
  })
})

describe('passwordChangedEmail', () => {
  const when = new Date('2026-09-16T08:30:00Z')
  const mail = passwordChangedEmail({ when, forgotUrl: 'https://pickle.minim.nz/sign-in/forgot' })

  /**
   * Sent after a password changes, whoever changed it. If it was not the
   * account's owner, this email is how they find out — so it must tell them
   * what to do, and it must not itself be a way in.
   */
  it('says when, in the venue’s own time zone', () => {
    expect(mail.text).toMatch(/16 September 2026/)
    expect(mail.text).toMatch(/8:30\s?pm/i)
  })

  it('tells somebody who did not do it how to take the account back', () => {
    expect(mail.text).toMatch(/was not you|wasn’t you|not you/i)
    expect(mail.text).toContain('https://pickle.minim.nz/sign-in/forgot')
    expect(mail.text).toMatch(/administrator/i)
  })

  it('carries no sign-in token of its own', () => {
    expect(mail.text).not.toMatch(/sign-in\/link\//)
  })
})
