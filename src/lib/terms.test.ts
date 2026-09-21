import { describe, expect, it } from 'vitest'
import { said } from './toast'
import {
  actLockedBecause,
  actNameProblem,
  attendanceProblem,
  BILL_STATUSES,
  countProblem,
  dollarsProblem,
  FEE_STEP,
  feeProblem,
  type Figures,
  figuresLine,
  isBillStatus,
  isFigures,
  lockedBecause,
  MAX_CREW,
  MAX_TOKENS,
  modelLockedBecause,
  modelSaid,
  SPLIT_PRESETS,
  splitProblem,
  splitSaid,
  statusSaid,
  tidyName,
} from './terms'

/**
 * The number-level rules behind the acts and terms editor.
 *
 * `src/lib/intake.ts` pins these same messages today, for the enquiry form.
 * This is the one place they are allowed to be decided — get a boundary or a
 * word wrong here and the form and the event record drift apart, which is the
 * exact bug terms.ts exists to make impossible. Every message is asserted
 * verbatim: it is what a coordinator reads to decide what happens next.
 */

describe('feeProblem', () => {
  it('is fine with two zero fees', () => {
    expect(feeProblem(0, 0)).toBeNull()
  })

  it('is fine with an ordinary floor and ceiling', () => {
    expect(feeProblem(400, 900)).toBeNull()
  })

  it('is fine when the floor and ceiling are equal', () => {
    expect(feeProblem(500, 500)).toBeNull()
  })

  it('is fine exactly at the $100,000 ceiling', () => {
    expect(feeProblem(100_000, 100_000)).toBeNull()
  })

  it('refuses a negative fee', () => {
    expect(feeProblem(-1, 100)).toBe('A fee is a dollar figure, zero or more.')
  })

  it('refuses a fee that is not a number', () => {
    expect(feeProblem(NaN, 100)).toBe('A fee is a dollar figure, zero or more.')
  })

  it('refuses an infinite fee', () => {
    expect(feeProblem(Infinity, 100)).toBe('A fee is a dollar figure, zero or more.')
  })

  it('refuses a fee over $100,000', () => {
    expect(feeProblem(0, 100_000.01)).toBe('Check that fee — it is over $100,000.')
  })

  it('refuses a ceiling under its floor', () => {
    expect(feeProblem(900, 400)).toBe("An act's top fee cannot be under its floor.")
  })
})

describe('splitProblem', () => {
  it('is fine at 0%', () => {
    expect(splitProblem(0)).toBeNull()
  })

  it('is fine at an ordinary split', () => {
    expect(splitProblem(62)).toBeNull()
  })

  it('is fine at 100%', () => {
    expect(splitProblem(100)).toBeNull()
  })

  it('refuses a negative split', () => {
    expect(splitProblem(-1)).toBe('The split is a percentage from 0 to 100.')
  })

  it('refuses a split over 100', () => {
    expect(splitProblem(100.1)).toBe('The split is a percentage from 0 to 100.')
  })

  it('refuses a split that is not a number', () => {
    expect(splitProblem(NaN)).toBe('The split is a percentage from 0 to 100.')
  })
})

describe('attendanceProblem', () => {
  it('is fine with no room to check against', () => {
    expect(attendanceProblem([40, 80, 120], null)).toBeNull()
  })

  it('is fine with a room the great figure fits inside', () => {
    const room = { name: 'Main', holds: 220, seated: false }
    expect(attendanceProblem([40, 80, 120], room)).toBeNull()
  })

  it('refuses a fractional head count', () => {
    expect(attendanceProblem([40.5, 80, 120], null)).toBe(
      'Attendance is a head count — whole numbers.',
    )
  })

  it('refuses a negative head count', () => {
    expect(attendanceProblem([-1, 80, 120], null)).toBe(
      'Attendance is a head count — whole numbers.',
    )
  })

  it('refuses a head count that is not a number', () => {
    expect(attendanceProblem([NaN, 80, 120], null)).toBe(
      'Attendance is a head count — whole numbers.',
    )
  })

  it('refuses quiet, likely and great out of order', () => {
    expect(attendanceProblem([80, 40, 120], null)).toBe(
      'Attendance runs quiet, likely, great — each at least the one before.',
    )
  })

  it('is fine when great exactly fills the room', () => {
    const room = { name: 'Main', holds: 220, seated: false }
    expect(attendanceProblem([40, 80, 220], room)).toBeNull()
  })

  it('refuses a great figure one over what the room holds', () => {
    const room = { name: 'Main', holds: 220, seated: false }
    expect(attendanceProblem([40, 80, 221], room)).toBe(
      'Main holds 220 — a great night cannot be more than that.',
    )
  })

  it('says the room is seated only when it is', () => {
    const room = { name: 'Main', holds: 150, seated: true }
    expect(attendanceProblem([40, 80, 151], room)).toBe(
      'Main holds 150 seated — a great night cannot be more than that.',
    )
  })
})

describe('dollarsProblem', () => {
  it('is fine at zero', () => {
    expect(dollarsProblem(0)).toBeNull()
  })

  it('is fine exactly at $100,000', () => {
    expect(dollarsProblem(100_000)).toBeNull()
  })

  it('refuses a negative figure', () => {
    expect(dollarsProblem(-1)).toBe('That is a dollar figure, zero or more.')
  })

  it('refuses a figure that is not a number', () => {
    expect(dollarsProblem(NaN)).toBe('That is a dollar figure, zero or more.')
  })

  it('refuses an infinite figure', () => {
    expect(dollarsProblem(Infinity)).toBe('That is a dollar figure, zero or more.')
  })

  it('refuses a figure over $100,000', () => {
    expect(dollarsProblem(100_000.01)).toBe('That is a dollar figure, zero or more.')
  })
})

describe('countProblem', () => {
  it('is fine at zero', () => {
    expect(countProblem(0, 100)).toBeNull()
  })

  it('is fine exactly at the most bound', () => {
    expect(countProblem(100, 100)).toBeNull()
  })

  it('refuses a negative count', () => {
    expect(countProblem(-1, 100)).toBe('Crew and tokens are whole numbers, zero or more.')
  })

  it('refuses a fractional count', () => {
    expect(countProblem(2.5, 100)).toBe('Crew and tokens are whole numbers, zero or more.')
  })

  it('refuses a count that is not a number', () => {
    expect(countProblem(NaN, 100)).toBe('Crew and tokens are whole numbers, zero or more.')
  })

  it('refuses a count one over the most bound', () => {
    expect(countProblem(101, 100)).toBe('Crew and tokens are whole numbers, zero or more.')
  })
})

describe('actNameProblem', () => {
  it('refuses an empty name', () => {
    expect(actNameProblem('')).toBe('Give the act a name.')
  })

  it('refuses a name over 80 characters', () => {
    expect(actNameProblem('A'.repeat(81))).toBe("Keep each act's name under 80 characters.")
  })

  it('is fine with a name exactly 80 characters', () => {
    expect(actNameProblem('A'.repeat(80))).toBeNull()
  })
})

describe('tidyName', () => {
  it('trims the ends', () => {
    expect(tidyName('  The Beths  ')).toBe('The Beths')
  })

  it('collapses inner whitespace to a single space', () => {
    expect(tidyName('The    Beths')).toBe('The Beths')
  })
})

describe('BILL_STATUSES', () => {
  it('lists every status in the order it moves through', () => {
    expect(BILL_STATUSES).toEqual([
      { value: 'enquired', label: 'Enquired' },
      { value: 'pencilled', label: 'Pencilled' },
      { value: 'confirmed', label: 'Confirmed' },
      { value: 'declined', label: 'Declined' },
    ])
  })
})

describe('isBillStatus', () => {
  it('accepts the four statuses an act on the bill can hold', () => {
    expect(['enquired', 'pencilled', 'confirmed', 'declined'].every(isBillStatus)).toBe(true)
  })

  it('rejects anything that is not one of the four', () => {
    expect(isBillStatus('invited')).toBe(false)
    expect(isBillStatus('')).toBe(false)
  })
})

describe('SPLIT_PRESETS', () => {
  it('offers the house standard, an even split and all to them', () => {
    expect(SPLIT_PRESETS).toEqual([
      { percent: 60, label: 'House standard 60/40' },
      { percent: 50, label: 'Even split' },
      { percent: 100, label: 'All to them' },
    ])
  })
})

describe('FEE_STEP', () => {
  it("matches the prototype's bumpFee step", () => {
    expect(FEE_STEP).toBe(25)
  })
})

describe('lockedBecause', () => {
  it('does not stop a change while the night is still open', () => {
    expect(lockedBecause({ concluded: false })).toBeNull()
  })

  it('stops a change once the night is concluded', () => {
    expect(lockedBecause({ concluded: true })).toBe(
      'This night is put to bed — its figures are the settlement’s now.',
    )
  })
})

describe('actLockedBecause', () => {
  it('does not stop a change to an act that has not been paid', () => {
    expect(actLockedBecause({ name: 'The Beths', paid: false })).toBeNull()
  })

  it('stops a change to an act that has already been paid', () => {
    expect(actLockedBecause({ name: 'The Beths', paid: true })).toBe(
      'The Beths has been paid — their line is part of the settlement now.',
    )
  })
})

describe('modelLockedBecause', () => {
  it('does not stop a switch before any milestone has been raised', () => {
    expect(modelLockedBecause({ depositRaisedAt: null, invoiceRaisedAt: null })).toBeNull()
  })

  it('stops a switch once the deposit has been raised', () => {
    expect(
      modelLockedBecause({ depositRaisedAt: new Date('2026-09-01'), invoiceRaisedAt: null }),
    ).toBe(
      'A money milestone has already been raised on this booking — reverse it in Finance before switching the model.',
    )
  })

  it('stops a switch once the settlement invoice has been raised', () => {
    expect(
      modelLockedBecause({ depositRaisedAt: null, invoiceRaisedAt: new Date('2026-09-01') }),
    ).toBe(
      'A money milestone has already been raised on this booking — reverse it in Finance before switching the model.',
    )
  })
})

describe('statusSaid', () => {
  it('warns that the fee came out of the floor when an act is declined', () => {
    expect(statusSaid('The Beths', 'declined')).toEqual(
      said(
        'The Beths → declined. Their fee has come out of the floor, so the surplus moved.',
        'warn',
      ),
    )
  })

  it('is good news for every other status', () => {
    expect(statusSaid('The Beths', 'confirmed')).toEqual(said('The Beths → confirmed.'))
    expect(statusSaid('The Beths', 'pencilled')).toEqual(said('The Beths → pencilled.'))
  })
})

describe('splitSaid', () => {
  it('warns that the booking cannot be confirmed when the split is back to nothing', () => {
    expect(splitSaid(0)).toEqual(
      said(
        'Split back to nothing agreed — the booking cannot be confirmed until it is set.',
        'warn',
      ),
    )
  })

  it('is good news at any other split', () => {
    expect(splitSaid(60)).toEqual(
      said('60% of the surplus goes to their people — everybody’s floor is still paid first.'),
    )
  })
})

describe('modelSaid', () => {
  it("names the deposit invoice as dry hire's first milestone", () => {
    expect(modelSaid('dry')).toEqual(
      said('Dry hire — the first milestone is the 25% deposit invoice.'),
    )
  })

  it('lays out the three steps of the curator model', () => {
    expect(modelSaid('curator')).toEqual(
      said(
        'Curator model — step 1 booking enquiry, step 2 booking confirmed, then the settlement invoice.',
      ),
    )
  })
})

const figures = (over: Partial<Figures> = {}): Figures => ({
  att: [40, 80, 120],
  barHead: 20,
  gear: 200,
  adv: 100,
  crew: 6,
  tok: 2,
  ...over,
})

describe('figuresLine', () => {
  it('says nothing changed when every figure is the same', () => {
    expect(figuresLine(figures(), figures())).toBeNull()
  })

  it('names attendance on its own when a figure moves', () => {
    expect(figuresLine(figures(), figures({ att: [40, 80, 150] }))).toBe(
      'changed the figures — attendance 40 / 80 / 150',
    )
  })

  it('counts attendance as changed if any of the three moves, not just great', () => {
    expect(figuresLine(figures(), figures({ att: [45, 80, 120] }))).toBe(
      'changed the figures — attendance 45 / 80 / 120',
    )
  })

  it('names bar spend in money, a head', () => {
    expect(figuresLine(figures(), figures({ barHead: 25 }))).toBe(
      'changed the figures — bar spend $25 a head',
    )
  })

  it('names gear and hire in money, with the thousands comma and no cents', () => {
    expect(figuresLine(figures({ gear: 200 }), figures({ gear: 1200 }))).toBe(
      'changed the figures — gear and hire $1,200',
    )
  })

  it('names promotion in money', () => {
    expect(figuresLine(figures(), figures({ adv: 150 }))).toBe(
      'changed the figures — promotion $150',
    )
  })

  it('names crew as a plain count', () => {
    expect(figuresLine(figures(), figures({ crew: 8 }))).toBe('changed the figures — crew of 8')
  })

  it('names tokens as a plain count, a head', () => {
    expect(figuresLine(figures(), figures({ tok: 3 }))).toBe(
      'changed the figures — 3 tokens a head',
    )
  })

  it('joins several changed figures in the spec order, not the order they were set', () => {
    expect(figuresLine(figures(), figures({ tok: 3, att: [40, 80, 150], gear: 500 }))).toBe(
      'changed the figures — attendance 40 / 80 / 150, gear and hire $500, 3 tokens a head',
    )
  })
})

describe('how many crew, and how many tokens a head', () => {
  // The enquiry form and the event record both ask for these, and a bound
  // that lived in only one of them would be a bound the other could walk past.
  it('takes the ceilings the enquiry form has always had', () => {
    expect(MAX_CREW).toBe(100)
    expect(MAX_TOKENS).toBe(20)
  })
})

describe('isFigures', () => {
  const whole = { att: [60, 90, 120], barHead: 10, gear: 250, adv: 120, crew: 4, tok: 2 }

  it('knows a whole set of figures', () => {
    expect(isFigures(whole)).toBe(true)
  })

  // A server action is a POST anybody signed in can write by hand. The rules
  // above judge numbers; this is what stops something that is not numbers at
  // all from reaching them and throwing instead of being refused.
  const notFigures: [string, unknown][] = [
    ['nothing at all', null],
    ['a string', 'figures'],
    ['figures with no attendance', { ...whole, att: undefined }],
    ['attendance of two', { ...whole, att: [60, 90] }],
    ['attendance holding a string', { ...whole, att: [60, '90', 120] }],
    ['a figure typed as a string', { ...whole, gear: '250' }],
    ['a figure left out', { att: [60, 90, 120], barHead: 10, gear: 250, adv: 120, crew: 4 }],
  ]

  it.each(notFigures)('does not take %s for figures', (_, value) => {
    expect(isFigures(value)).toBe(false)
  })
})
