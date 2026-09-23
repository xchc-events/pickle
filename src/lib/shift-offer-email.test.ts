import { describe, expect, it } from 'vitest'
import { shiftOfferEmail } from './shift-offer-email'

/**
 * What the offer email says, as data — the sending is src/lib/email.ts, the
 * same split auth-email.ts keeps.
 */

const base = {
  personName: 'Ari Ngata',
  role: 'Bar staff',
  eventName: 'Static Bloom',
  when: '10 October 2026',
  times: '11:30pm–4:30am' as string | null,
  hours: 5,
  url: 'https://pickle.example/s/tok_abc123',
}

describe('shiftOfferEmail', () => {
  it('greets by first name only', () => {
    const mail = shiftOfferEmail(base)
    expect(mail.text).toMatch(/Kia ora Ari,/)
    expect(mail.html).toMatch(/Kia ora Ari,/)
  })

  it('names the role and the event in the subject', () => {
    const mail = shiftOfferEmail(base)
    expect(mail.subject).toMatch(/Bar staff/)
    expect(mail.subject).toMatch(/Static Bloom/)
  })

  it('carries the times and the hours when the times are known', () => {
    const mail = shiftOfferEmail(base)
    expect(mail.text).toMatch(/11:30pm–4:30am/)
    expect(mail.text).toMatch(/5h/)
  })

  it('falls back to the hours alone when the times are not decided yet', () => {
    const mail = shiftOfferEmail({ ...base, times: null })
    expect(mail.text).not.toMatch(/undefined/)
    expect(mail.text).toMatch(/5h/)
  })

  it('carries the link, live, once', () => {
    const mail = shiftOfferEmail(base)
    expect(mail.text.split(base.url)).toHaveLength(2)
    expect(mail.html).toContain(base.url)
  })

  it('says the link works once and for seven days', () => {
    const mail = shiftOfferEmail(base)
    expect(mail.text).toMatch(/once/)
    expect(mail.text).toMatch(/7 days/)
  })

  it('escapes a name that could break the HTML', () => {
    const mail = shiftOfferEmail({ ...base, personName: 'Ari <script>alert(1)</script>' })
    expect(mail.html).not.toContain('<script>')
  })

  it('copes with a one-word name', () => {
    const mail = shiftOfferEmail({ ...base, personName: 'Ari' })
    expect(mail.text).toMatch(/Kia ora Ari,/)
  })
})
