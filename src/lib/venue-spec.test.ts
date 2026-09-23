import { describe, expect, it } from 'vitest'
import {
  assembleVenueSpecText,
  recipientsMissingEmail,
  tickableComponents,
  venueSpecEmail,
  type SpecRecipient,
  type VenueSpecComponentRow,
} from './venue-spec'

/**
 * The venue spec sheet, assembled.
 *
 * Connor, 23 Sep 2026: "It'd be better to have a more full-featured option
 * where you can select which components of a venue spec sheet you're
 * sending out, as not all of them are relevant to all people." The thing
 * worth getting exactly right is order: house order, not tick order, and
 * never a component that is inactive or unticked.
 */

const COMPONENTS: VenueSpecComponentRow[] = [
  { key: 'room', title: 'Room dimensions and capacity', body: '12m x 8m, 250 capacity.', order: 0, active: true },
  { key: 'stage', title: 'Stage', body: '6m x 4m, 600mm high.', order: 1, active: true },
  { key: 'pa', title: 'PA and monitors', body: 'd&b Y-series, 4 wedges.', order: 2, active: true },
  { key: 'power', title: 'Power', body: 'retired — folded into Stage.', order: 3, active: false },
  { key: 'contacts', title: 'Contacts', body: 'Duty manager on the night.', order: 4, active: true },
]

describe('tickableComponents', () => {
  it('offers active components in house order', () => {
    expect(tickableComponents(COMPONENTS).map((c) => c.key)).toEqual([
      'room',
      'stage',
      'pa',
      'contacts',
    ])
  })

  it('leaves out an inactive component', () => {
    expect(tickableComponents(COMPONENTS).map((c) => c.key)).not.toContain('power')
  })

  it('sorts by order even when the rows arrive out of order', () => {
    const shuffled = [COMPONENTS[4]!, COMPONENTS[0]!, COMPONENTS[2]!, COMPONENTS[1]!]
    expect(tickableComponents(shuffled).map((c) => c.key)).toEqual(['room', 'stage', 'pa', 'contacts'])
  })
})

describe('assembleVenueSpecText', () => {
  it('carries exactly the ticked components, in house order', () => {
    const text = assembleVenueSpecText(COMPONENTS, ['contacts', 'room', 'pa'])
    const order = ['room', 'pa', 'contacts'].map((k) => COMPONENTS.find((c) => c.key === k)!.title)
    // Ticked out of order ("contacts, room, pa") still reads room, pa, contacts.
    expect(order.every((title, i) => text.indexOf(title) >= 0)).toBe(true)
    expect(text.indexOf('Room dimensions and capacity')).toBeLessThan(text.indexOf('PA and monitors'))
    expect(text.indexOf('PA and monitors')).toBeLessThan(text.indexOf('Contacts'))
  })

  it('leaves out a component that was not ticked', () => {
    const text = assembleVenueSpecText(COMPONENTS, ['room'])
    expect(text).toContain('Room dimensions and capacity')
    expect(text).not.toContain('Stage')
    expect(text).not.toContain('PA and monitors')
  })

  it('refuses to include an inactive component even if it is named in the ticked keys', () => {
    const text = assembleVenueSpecText(COMPONENTS, ['power', 'room'])
    expect(text).not.toContain('Power')
    expect(text).toContain('Room dimensions and capacity')
  })

  it('carries each component’s own body underneath its title', () => {
    const text = assembleVenueSpecText(COMPONENTS, ['stage'])
    expect(text).toContain('Stage\n6m x 4m, 600mm high.')
  })

  it('is empty when nothing is ticked', () => {
    expect(assembleVenueSpecText(COMPONENTS, [])).toBe('')
  })
})

describe('recipientsMissingEmail', () => {
  const recipients: SpecRecipient[] = [
    { payeeId: 'pay_1', name: 'Static Bloom', email: 'static@example.test' },
    { payeeId: 'pay_2', name: 'Kōura Records', email: null },
    { payeeId: 'pay_3', name: 'No One Ticked', email: null },
  ]

  it('names a ticked recipient with no email on file', () => {
    const missing = recipientsMissingEmail(recipients, ['pay_1', 'pay_2'])
    expect(missing.map((r) => r.name)).toEqual(['Kōura Records'])
  })

  it('is empty when every ticked recipient has an email', () => {
    expect(recipientsMissingEmail(recipients, ['pay_1'])).toEqual([])
  })

  it('ignores a recipient with no email who was never ticked', () => {
    expect(recipientsMissingEmail(recipients, ['pay_1']).map((r) => r.payeeId)).not.toContain('pay_3')
  })
})

describe('venueSpecEmail', () => {
  const mail = venueSpecEmail('Static Bloom @ XCHC', 'Room dimensions and capacity\n12m x 8m.')

  it('names the event in the subject', () => {
    expect(mail.subject).toContain('Static Bloom @ XCHC')
  })

  it('puts the assembled text in the plain-text part', () => {
    expect(mail.text).toContain('Room dimensions and capacity\n12m x 8m.')
  })

  it('escapes the text before it goes anywhere near the HTML', () => {
    const withMarkup = venueSpecEmail('Test', '<img src=x onerror=alert(1)>')
    expect(withMarkup.html).not.toContain('<img src=x')
    expect(withMarkup.html).toContain('&lt;img')
  })
})
