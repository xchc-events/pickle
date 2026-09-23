import { describe, expect, it } from 'vitest'
import {
  assembleRunSheetText,
  runSheetEmail,
  seedRunSheetRows,
  type EventRunTimes,
  type RunSheetRow,
} from './run-sheet'

/**
 * The tech run sheet.
 *
 * Connor, 23 Sep 2026: "A section here which allows you to fill in a run
 * sheet, like a tech run sheet, would be really helpful." Two things worth
 * getting exactly right: a new event starts from its own times rather than a
 * blank sheet, and what gets emailed reads in row order.
 */

describe('seedRunSheetRows', () => {
  it('builds one row per time the event has set, in the roster’s own order', () => {
    const times: EventRunTimes = {
      packIn: '3:00pm',
      doors: '8:00pm',
      barClose: '1:00am',
      allOut: '1:30am',
      packOut: '3:00am',
    }
    expect(seedRunSheetRows(times).map((r) => r.item)).toEqual([
      'Pack-in',
      'Doors',
      'Bar close',
      'Everyone out',
      'Pack-out',
    ])
  })

  it('carries each field’s own clock string onto its row', () => {
    const times: EventRunTimes = {
      packIn: null,
      doors: '8:00pm',
      barClose: null,
      allOut: '1:30am',
      packOut: null,
    }
    const rows = seedRunSheetRows(times)
    expect(rows.find((r) => r.item === 'Doors')?.time).toBe('8:00pm')
    expect(rows.find((r) => r.item === 'Everyone out')?.time).toBe('1:30am')
  })

  it('skips a time the event has not set yet, rather than seeding a blank row', () => {
    const times: EventRunTimes = {
      packIn: null,
      doors: '8:00pm',
      barClose: null,
      allOut: null,
      packOut: null,
    }
    expect(seedRunSheetRows(times).map((r) => r.item)).toEqual(['Doors'])
  })

  it('seeds nothing when the event has no times set at all', () => {
    const times: EventRunTimes = {
      packIn: null,
      doors: null,
      barClose: null,
      allOut: null,
      packOut: null,
    }
    expect(seedRunSheetRows(times)).toEqual([])
  })

  it('gives every seeded row no id, since nothing has been saved yet', () => {
    const rows = seedRunSheetRows({
      packIn: null,
      doors: '8:00pm',
      barClose: null,
      allOut: null,
      packOut: null,
    })
    expect(rows.every((r) => r.id === null)).toBe(true)
  })
})

describe('assembleRunSheetText', () => {
  const rows: RunSheetRow[] = [
    { id: '1', time: '8:00pm', item: 'Doors', who: null, note: null, order: 1 },
    { id: '2', time: '3:00pm', item: 'Pack-in', who: 'Crew', note: null, order: 0 },
    { id: '3', time: '1:30am', item: 'Everyone out', who: null, note: 'lights up slow', order: 2 },
  ]

  it('reads in row order, not the order the rows arrive in', () => {
    const text = assembleRunSheetText(rows)
    const lines = text.split('\n')
    expect(lines[0]).toContain('Pack-in')
    expect(lines[1]).toContain('Doors')
    expect(lines[2]).toContain('Everyone out')
  })

  it('carries the time, item, who and note on one line', () => {
    const text = assembleRunSheetText(rows)
    expect(text).toContain('3:00pm — Pack-in — Crew')
    expect(text).toContain('1:30am — Everyone out — lights up slow')
  })

  it('drops a blank who or note rather than leaving a trailing dash', () => {
    const text = assembleRunSheetText(rows)
    expect(text).toContain('8:00pm — Doors')
    expect(text).not.toMatch(/Doors — —/)
    expect(text).not.toMatch(/Doors —\s*$/m)
  })

  it('is empty for no rows', () => {
    expect(assembleRunSheetText([])).toBe('')
  })
})

describe('runSheetEmail', () => {
  const mail = runSheetEmail('Static Bloom @ XCHC', '3:00pm — Pack-in — Crew')

  it('names the event in the subject', () => {
    expect(mail.subject).toContain('Static Bloom @ XCHC')
  })

  it('puts the assembled text in the plain-text part', () => {
    expect(mail.text).toContain('3:00pm — Pack-in — Crew')
  })

  it('escapes the text before it goes anywhere near the HTML', () => {
    const withMarkup = runSheetEmail('Test', '<img src=x onerror=alert(1)>')
    expect(withMarkup.html).not.toContain('<img src=x')
    expect(withMarkup.html).toContain('&lt;img')
  })
})
