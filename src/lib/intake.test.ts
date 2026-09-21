import { describe, expect, it } from 'vitest'
import { dateLabel } from './format'
import { nightInput, nightOf } from './night'
import {
  ACT_STATUSES,
  ATTENDANCE_SPREAD,
  cleanEnquiry,
  FIELD,
  FIELD_ORDER,
  firstError,
  FORMAT_FOR_KIND,
  FORMATS,
  HOUSE_STARTING_POINTS,
  HOUSE_TASKS,
  internalContact,
  KINDS,
  MAX_ACTS,
  MODELS,
  mayStartEnquiry,
  readEnquiryForm,
  SOUNDS,
  startedLine,
  startedSaid,
  usualAttendance,
  type CleanEnquiry,
  type FieldErrors,
  type FieldKey,
  type IntakeContext,
  type IntakeSpace,
  type IntakeUser,
  type RawAct,
  type RawEnquiry,
} from './intake'

/**
 * Starting a booking.
 *
 * Until now nothing but `prisma/seed.ts` could create an event, and the fields
 * this form captures — the owner, the model, the split, the attendance spread,
 * the bar and gear figures, the act fees — have no writer anywhere else. What
 * is typed here is what the P&L runs on for the life of the booking, so a
 * figure read wrongly at intake is a figure nobody ever corrects.
 *
 * The rule that matters most is the last one: an outside promoter reaches the
 * same endpoint through the same module, and everything they are not allowed
 * to set is FIXED here rather than merely hidden from their form. Hiding a
 * control is not access control; a promoter with curl has the whole POST body.
 */

// ------------------------------------------------------------- fixtures ---

const MAIN: IntakeSpace = { id: 'space_main', name: 'Main', capacity: 220, seatedCapacity: 150 }

const staff: IntakeUser = { external: false, organisationId: null }
const outside: IntakeUser = { external: true, organisationId: 'org_koura' }
const outsideNoOrg: IntakeUser = { external: true, organisationId: null }

/** Friday 18 September 2026 — the night the rest of these dates are measured from. */
const TODAY = nightOf(2026, 8, 18)

/** The night the fixture books: Saturday 3 October 2026. */
const NIGHT = nightOf(2026, 9, 3)

const NO_ORGANISATION =
  'This account is not attached to a promoter organisation yet, so an enquiry would have nowhere to belong. Your coordinator at the venue can set that up.'

/** A complete, valid enquiry as a coordinator would type it. */
const raw = (over: Partial<RawEnquiry> = {}): RawEnquiry => ({
  name: 'Kōura Records presents Hiwa',
  date: '2026-10-03',
  dateTbc: false,
  spaceId: 'space_main',
  kind: 'live',
  format: 'Live music',
  doors: '20:00',
  barClose: '01:00',
  allOut: '02:00',
  // Blank: doors 8pm to all-out 2am auto-fills to the next night — see "the
  // run times" below. Left this way so tests that override `date` do not
  // also have to keep a hand-typed `endDate` in step with it.
  endDate: '',
  model: 'curator',
  std: '25',
  door: '30',
  mixSub: '20',
  mixStd: '40',
  mixSup: '15',
  mixDoor: '25',
  attQuiet: '88',
  attLikely: '136',
  attGreat: '198',
  barHead: '20',
  gear: '200',
  adv: '100',
  sound: 'inhouse',
  crew: '6',
  tok: '2',
  acts: [
    { name: 'Hiwa', status: 'confirmed', low: '400', high: '900' },
    { name: 'Tautoko', status: 'pencilled', low: '250', high: '500' },
  ],
  note: 'They want the back bar open.',
  alt1: '',
  alt2: '',
  ownerId: 'person_ana',
  bringing: 'organisation',
  organisationId: 'org_koura',
  promoterName: '',
  split: '62',
  brief: 'Loud, warm, local.',
  hold: true,
  ...over,
})

const ctx = (over: Partial<IntakeContext> = {}): IntakeContext => ({
  user: staff,
  today: TODAY,
  spaces: [MAIN],
  ...over,
})

/** A night `n` nights from today, written the way `<input type="date">` sends it. */
const nights = (n: number): string => nightInput(new Date(TODAY.getTime() + n * 86_400_000))

/** The cleaned enquiry. Fails naming the refusal if it was refused instead. */
const cleaned = (over: Partial<RawEnquiry> = {}, user: IntakeUser = staff): CleanEnquiry => {
  const out = cleanEnquiry(raw(over), ctx({ user }))
  expect(out.ok ? null : firstError(out.errors)).toBeNull()
  if (!out.ok) throw new Error('refused')
  return out.value
}

/** The errors a raw enquiry produces. Fails if it was accepted instead. */
const refusal = (over: Partial<RawEnquiry>, user: IntakeUser = staff): FieldErrors => {
  const out = cleanEnquiry(raw(over), ctx({ user }))
  expect(out.ok).toBe(false)
  return out.ok ? {} : out.errors
}

/** A string of exactly `n` characters, for the length limits. */
const chars = (n: number): string => 'x'.repeat(n)

// ----------------------------------------------------------- vocabulary ---

describe('the vocabulary', () => {
  it('knows the four kinds of night the rest of the code understands', () => {
    expect(KINDS.map((k) => k.value)).toEqual(['live', 'djs', 'live-djs', 'workshop'])
  })

  it('knows the four ways the room is set', () => {
    expect([...FORMATS]).toEqual(['Live music', 'DJs', 'DJs + live', 'Cabaret'])
  })

  it('preselects a format for every kind, and only ever a real format', () => {
    // The form fills the format in when the kind changes; a kind with no
    // format, or one pointing at a made-up format, would put a capacity check
    // on a room setting that does not exist.
    for (const kind of KINDS) {
      expect(FORMATS, kind.value).toContain(FORMAT_FOR_KIND[kind.value])
    }
    expect(FORMAT_FOR_KIND).toEqual({
      live: 'Live music',
      djs: 'DJs',
      'live-djs': 'DJs + live',
      workshop: 'Cabaret',
    })
  })

  it('offers the two sound systems and the two booking models', () => {
    expect(SOUNDS.map((s) => s.value)).toEqual(['inhouse', 'wheke'])
    expect(MODELS.map((m) => m.value)).toEqual(['curator', 'dry'])
  })

  it('offers the three act statuses an enquiry can start at', () => {
    // No 'declined' here: nothing is declined at the moment it is enquired about.
    expect(ACT_STATUSES.map((a) => a.value)).toEqual(['enquired', 'pencilled', 'confirmed'])
  })

  it('takes twelve acts at the most', () => {
    expect(MAX_ACTS).toBe(12)
  })

  /**
   * The off-site work every event is planned with. `prisma/seed.ts` reads the
   * same list, so a seeded event and a form-made one carry identical
   * estimates — and these hours are the wage line in the P&L, not decoration.
   */
  it('plans 22.5 hours of off-site work on every event', () => {
    expect(HOUSE_TASKS).toEqual([
      { name: 'Event coordination', est: 9 },
      { name: 'Design & comms', est: 6 },
      { name: 'Comms / socials', est: 3 },
      { name: 'Production management', est: 1.5 },
      { name: 'Bar admin & accounting', est: 3 },
    ])
    expect(HOUSE_TASKS.reduce((n, t) => n + t.est, 0)).toBe(22.5)
  })

  it('starts the staff form on the house figures', () => {
    expect(HOUSE_STARTING_POINTS).toEqual({
      barHead: 20,
      gear: 200,
      adv: 100,
      crew: 6,
      tok: 2,
      sound: 'inhouse',
    })
  })
})

describe('usualAttendance', () => {
  it('is quiet, likely and great as a share of the room', () => {
    expect([...ATTENDANCE_SPREAD]).toEqual([0.4, 0.62, 0.9])
    expect(usualAttendance(220)).toEqual([88, 136, 198])
  })

  it('works off the seated capacity when that is the room', () => {
    expect(usualAttendance(150)).toEqual([60, 93, 135])
  })
})

// ------------------------------------------------------ who may start one ---

describe('mayStartEnquiry', () => {
  it('lets anybody inside the venue start one', () => {
    expect(mayStartEnquiry(staff)).toEqual({ ok: true })
  })

  it('lets an outside account with an organisation start one', () => {
    expect(mayStartEnquiry(outside)).toEqual({ ok: true })
  })

  /**
   * Without an organisation the event could never be scoped back to them —
   * they would send an enquiry and then not be able to see it.
   */
  it('refuses an outside account with nothing to attach the enquiry to', () => {
    expect(mayStartEnquiry(outsideNoOrg)).toEqual({ ok: false, why: NO_ORGANISATION })
  })
})

// ---------------------------------------------------------- cleanEnquiry ---

describe('cleanEnquiry, for a coordinator', () => {
  it('reads every field of a filled-in form', () => {
    expect(cleaned()).toEqual({
      name: 'Kōura Records presents Hiwa',
      date: NIGHT,
      dateTbc: false,
      spaceId: 'space_main',
      kind: 'live',
      format: 'Live music',
      doors: '8:00pm',
      barClose: '1:00am',
      allOut: '2:00am',
      endDate: nightOf(2026, 9, 4),
      model: 'curator',
      std: 25,
      door: 30,
      // Percentages on the form, fractions on the record — the order
      // finance.ts reads: subsidised, standard, supporter, door.
      mix: [0.2, 0.4, 0.15, 0.25],
      acts: [
        { name: 'Hiwa', status: 'confirmed', low: 400, high: 900 },
        { name: 'Tautoko', status: 'pencilled', low: 250, high: 500 },
      ],
      note: 'They want the back bar open.',
      alternates: [],
      ownerId: 'person_ana',
      bringing: { by: 'organisation', organisationId: 'org_koura' },
      // A percentage on the form, 0–1 on the record, because that is how the
      // schema stores it and how finance.ts reads it.
      split: 0.62,
      att: [88, 136, 198],
      barHead: 20,
      gear: 200,
      adv: 100,
      sound: 'inhouse',
      crew: 6,
      tok: 2,
      brief: 'Loud, warm, local.',
      hold: true,
    })
  })

  it('stores the night as the night, not as the string that was typed', () => {
    expect(cleaned().date.toISOString()).toBe('2026-10-03T00:00:00.000Z')
  })

  it('reads a time nobody typed as not decided yet, rather than as midnight', () => {
    const value = cleaned({ doors: '', barClose: '', allOut: '' })
    expect(value.doors).toBeNull()
    expect(value.barClose).toBeNull()
    expect(value.allOut).toBeNull()
  })

  it('reads an empty note, brief and owner as nothing said and nobody named', () => {
    const value = cleaned({ note: '   ', brief: '', ownerId: '' })
    expect(value.note).toBeNull()
    expect(value.brief).toBeNull()
    expect(value.ownerId).toBeNull()
  })

  it('tidies the whitespace out of every name it keeps', () => {
    // What every screen calls the event, so " Hiwa   &  Tautoko " must not be
    // what the pipeline shows.
    const value = cleaned({
      name: '  Kōura  Records\n presents   Hiwa ',
      bringing: 'name',
      promoterName: ' Kōura   Records ',
      acts: [{ name: '  Hiwa   Tapu ', status: '', low: '', high: '' }],
    })
    expect(value.name).toBe('Kōura Records presents Hiwa')
    expect(value.bringing).toEqual({ by: 'name', name: 'Kōura Records' })
    expect(value.acts[0]!.name).toBe('Hiwa Tapu')
  })

  it('drops the rows nobody filled in and keeps the rest in order', () => {
    const value = cleaned({
      acts: [
        { name: '', status: '', low: '', high: '' },
        { name: 'Hiwa', status: '', low: '', high: '' },
        { name: '   ', status: '', low: '', high: '' },
        { name: 'Tautoko', status: 'pencilled', low: '250', high: '500' },
        { name: '', status: '', low: '', high: '' },
      ],
    })
    expect(value.acts).toEqual([
      { name: 'Hiwa', status: 'enquired', low: 0, high: 0 },
      { name: 'Tautoko', status: 'pencilled', low: 250, high: 500 },
    ])
  })
})

// ----------------------------------------------------------- field rules ---

describe('the name', () => {
  const TOO_SHORT = 'Give the event a name — it is what every screen calls it.'
  const TOO_LONG = 'Keep the name under 120 characters.'

  it('is wanted', () => {
    expect(refusal({ name: '   ' }).name).toBe(TOO_SHORT)
  })

  it('needs two characters to be a name at all', () => {
    expect(refusal({ name: 'x' }).name).toBe(TOO_SHORT)
    expect(cleaned({ name: 'xy' }).name).toBe('xy')
  })

  it('stops at 120 characters', () => {
    expect(cleaned({ name: chars(120) }).name).toBe(chars(120))
    expect(refusal({ name: chars(121) }).name).toBe(TOO_LONG)
  })
})

describe('the night', () => {
  const NOT_A_NIGHT = 'Pick the night.'
  const GONE = 'That night has already been — pick one still to come.'
  const LONG_AGO = 'That is more than a year ago — check the year.'
  const FAR_OFF = 'That is more than three years out — check the year.'

  it('has to be a real date', () => {
    expect(refusal({ date: '' }).date).toBe(NOT_A_NIGHT)
    expect(refusal({ date: '2026-02-30' }).date).toBe(NOT_A_NIGHT)
    expect(refusal({ date: '03/10/2026' }).date).toBe(NOT_A_NIGHT)
  })

  /**
   * An outside account is asking for a night, not recording one that happened.
   * Staff record past nights all the time — an event that ran before the venue
   * started using this gets typed in after the fact.
   */
  it('cannot be in the past for an outside account', () => {
    expect(cleaned({ date: nights(0) }, outside).date).toEqual(TODAY)
    expect(refusal({ date: nights(-1) }, outside).date).toBe(GONE)
  })

  it('lets staff go a year back but no further', () => {
    expect(cleaned({ date: nights(-366) }).date).toEqual(nightOf(2025, 8, 17))
    expect(refusal({ date: nights(-367) }).date).toBe(LONG_AGO)
  })

  it('stops anybody booking more than three years out', () => {
    // Three years of holds is a typo in the year, not a plan.
    expect(cleaned({ date: nights(1100) }).date).toEqual(nightOf(2029, 8, 22))
    expect(refusal({ date: nights(1101) }).date).toBe(FAR_OFF)
  })
})

describe('the room, the kind and the format', () => {
  it('has to be a room on the books', () => {
    expect(refusal({ spaceId: 'space_nope' }).spaceId).toBe('Pick the room this is booked into.')
    expect(refusal({ spaceId: '' }).spaceId).toBe('Pick the room this is booked into.')
  })

  it('has to be a kind of night the roster understands', () => {
    const why = 'Say what kind of night it is — it drives the roster.'
    expect(refusal({ kind: 'rave' }).kind).toBe(why)
    expect(refusal({ kind: '' }).kind).toBe(why)
  })

  it('has to be a way the room is actually set', () => {
    expect(refusal({ format: 'Standing' }).format).toBe('Pick how the room is set.')
    expect(refusal({ format: '' }).format).toBe('Pick how the room is set.')
  })
})

describe('the run times', () => {
  it('takes any time, not just one off a fixed list', () => {
    const value = cleaned({ doors: '15:00', barClose: '19:30', allOut: '' })
    expect(value.doors).toBe('3:00pm')
    expect(value.barClose).toBe('7:30pm')
  })

  it('refuses a time that is not a time', () => {
    const why = 'That is not a time.'
    expect(refusal({ doors: 'noon' }).doors).toBe(why)
    expect(refusal({ barClose: '25:99' }).barClose).toBe(why)
    expect(refusal({ allOut: 'whenever' }).allOut).toBe(why)
  })

  it('reads a time nobody typed as not decided yet, rather than as midnight', () => {
    const value = cleaned({ doors: '', barClose: '', allOut: '' })
    expect(value.doors).toBeNull()
    expect(value.barClose).toBeNull()
    expect(value.allOut).toBeNull()
  })

  it('fills in the end night nobody typed — 8pm to 1am gives the next night', () => {
    const value = cleaned({ doors: '20:00', allOut: '01:00', endDate: '' })
    expect(value.endDate).toEqual(nightOf(2026, 9, 4))
  })

  it('keeps a typed end date rather than working one out', () => {
    const value = cleaned({ doors: '20:00', allOut: '01:00', endDate: '2026-10-06' })
    expect(value.endDate).toEqual(nightOf(2026, 9, 6))
  })

  it('refuses an end date that is not a date', () => {
    const why = 'Pick the night it ends.'
    expect(refusal({ endDate: 'whenever' }).endDate).toBe(why)
    expect(refusal({ endDate: '2026-02-30' }).endDate).toBe(why)
  })

  it('will not end before it starts', () => {
    expect(refusal({ endDate: '2026-10-02' }).endDate).toBe(
      'The night cannot end before it starts.',
    )
  })

  it('will not run more than two weeks start to finish', () => {
    expect(refusal({ endDate: '2026-10-18' }).endDate).toBe(
      'That is more than two weeks from start to finish — check the dates.',
    )
  })

  it('will not empty the room before the doors open', () => {
    const value = refusal({ doors: '20:00', endDate: '2026-10-03', allOut: '19:00', barClose: '' })
    expect(value.allOut).toBe('Everyone out has to be after the doors open.')
  })

  it('will not close the bar at the moment the doors open', () => {
    const value = refusal({ doors: '20:00', barClose: '20:00', allOut: '', endDate: '' })
    expect(value.barClose).toBe('The bar closes after the doors open and before everyone is out.')
  })

  it('lets the bar close exactly when everyone is out — that is a normal night', () => {
    // Doors 8pm, bar closes and everyone is out at 1am — the same instant,
    // the next night along.
    const value = cleaned({ doors: '20:00', barClose: '01:00', allOut: '01:00', endDate: '' })
    expect(value.barClose).toBe('1:00am')
    expect(value.allOut).toBe('1:00am')
  })
})

describe('the acts', () => {
  const act = (over: Partial<RawAct> = {}): RawAct => ({
    name: 'Hiwa',
    status: '',
    low: '',
    high: '',
    ...over,
  })

  it('will not take fees for an act nobody named', () => {
    // A fee with no act is a fee that lands in the P&L attached to nothing.
    expect(refusal({ acts: [act({ name: '  ', low: '400' })] }).acts).toBe(
      'Name the act those fees are for.',
    )
  })

  it('takes twelve acts and no more', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => act({ name: `Act ${i + 1}` }))
    expect(cleaned({ acts: rows(12) }).acts).toHaveLength(12)
    expect(refusal({ acts: rows(13) }).acts).toBe(
      'Twelve acts is the most one booking takes — put the rest in the note.',
    )
  })

  it('keeps each name short enough to read on a poster line', () => {
    expect(cleaned({ acts: [act({ name: chars(80) })] }).acts[0]!.name).toBe(chars(80))
    expect(refusal({ acts: [act({ name: chars(81) })] }).acts).toBe(
      "Keep each act's name under 80 characters.",
    )
  })

  it('takes only a status an act can start at', () => {
    expect(cleaned({ acts: [act({ status: '' })] }).acts[0]!.status).toBe('enquired')
    expect(refusal({ acts: [act({ status: 'declined' })] }).acts).toBe(
      'Each act is enquired, pencilled or confirmed.',
    )
  })

  it('reads a blank fee as nothing agreed, and junk as a mistake', () => {
    const why = 'A fee is a dollar figure, zero or more.'
    expect(cleaned({ acts: [act({ low: '', high: '' })] }).acts[0]).toEqual({
      name: 'Hiwa',
      status: 'enquired',
      low: 0,
      high: 0,
    })
    expect(refusal({ acts: [act({ low: '400x' })] }).acts).toBe(why)
    expect(refusal({ acts: [act({ high: 'NaN' })] }).acts).toBe(why)
    expect(refusal({ acts: [act({ low: '-1' })] }).acts).toBe(why)
  })

  it('queries a fee over $100,000 rather than paying it', () => {
    expect(cleaned({ acts: [act({ low: '0', high: '100000' })] }).acts[0]!.high).toBe(100000)
    expect(refusal({ acts: [act({ low: '0', high: '100000.01' })] }).acts).toBe(
      'Check that fee — it is over $100,000.',
    )
  })

  it('will not take a ceiling under the floor', () => {
    expect(refusal({ acts: [act({ low: '900', high: '400' })] }).acts).toBe(
      "An act's top fee cannot be under its floor.",
    )
  })
})

describe('the note and the brief', () => {
  it('keeps the note to a page', () => {
    expect(cleaned({ note: chars(1000) }).note).toBe(chars(1000))
    expect(refusal({ note: chars(1001) }).note).toBe('Keep the note under 1,000 characters.')
  })

  it('keeps the brief to a line or two', () => {
    expect(cleaned({ brief: chars(280) }).brief).toBe(chars(280))
    expect(refusal({ brief: chars(281) }).brief).toBe(
      'Keep the brief to a line or two — under 280 characters.',
    )
  })
})

describe('alternate dates', () => {
  it('takes up to two, dropping blanks', () => {
    expect(cleaned({ alt1: nights(1), alt2: nights(2) }).alternates).toEqual([
      nightOf(2026, 8, 19),
      nightOf(2026, 8, 20),
    ])
    expect(cleaned({ alt1: nights(1), alt2: '' }).alternates).toEqual([nightOf(2026, 8, 19)])
    expect(cleaned({ alt1: '', alt2: '' }).alternates).toEqual([])
  })

  it('refuses one that is not a date', () => {
    expect(refusal({ alt1: 'whenever' }).alternates).toBe('That is not a date.')
  })

  it('lets staff note one that has already been', () => {
    expect(cleaned({ alt1: nights(-10) }).alternates).toEqual([nightOf(2026, 8, 8)])
  })

  it('refuses one before today for an outside account', () => {
    expect(refusal({ alt1: nights(-1) }, outside).alternates).toBe(
      'That night has already been — pick one still to come.',
    )
  })
})

describe('the owner and the model', () => {
  it('keeps whoever was named, and checks them against the database later', () => {
    expect(cleaned({ ownerId: 'person_mere' }).ownerId).toBe('person_mere')
    expect(cleaned({ ownerId: '' }).ownerId).toBeNull()
  })

  it('starts on the curator model when nothing is chosen', () => {
    expect(cleaned({ model: '' }).model).toBe('curator')
    expect(cleaned({ model: 'dry' }).model).toBe('dry')
  })

  it('takes only a model the venue works to', () => {
    expect(refusal({ model: 'freehold' }).model).toBe(
      'Pick how the venue and the promoter are working together.',
    )
  })
})

describe('who is bringing it', () => {
  it('is the venue, an organisation on file, or a name', () => {
    expect(cleaned({ bringing: 'venue' }).bringing).toEqual({ by: 'venue' })
    expect(cleaned({ bringing: 'organisation', organisationId: 'org_koura' }).bringing).toEqual({
      by: 'organisation',
      organisationId: 'org_koura',
    })
    expect(cleaned({ bringing: 'name', promoterName: 'Kōura Records' }).bringing).toEqual({
      by: 'name',
      name: 'Kōura Records',
    })
  })

  it('has to be one of those three', () => {
    expect(refusal({ bringing: '' }).bringing).toBe('Say who is bringing this.')
    expect(refusal({ bringing: 'somebody' }).bringing).toBe('Say who is bringing this.')
  })

  it('wants the organisation named when an organisation is bringing it', () => {
    expect(refusal({ bringing: 'organisation', organisationId: '' }).organisationId).toBe(
      'Pick the organisation bringing it.',
    )
  })

  it('wants a real name when somebody not on file is bringing it', () => {
    const why = 'Name whoever is bringing it.'
    expect(refusal({ bringing: 'name', promoterName: '' }).promoterName).toBe(why)
    expect(refusal({ bringing: 'name', promoterName: 'x' }).promoterName).toBe(why)
    expect(refusal({ bringing: 'name', promoterName: chars(81) }).promoterName).toBe(why)
  })
})

describe('the split', () => {
  const why = 'The split is a percentage from 0 to 100.'

  it('is typed as a percentage and stored as a share', () => {
    expect(cleaned({ split: '62' }).split).toBe(0.62)
    expect(cleaned({ split: '0' }).split).toBe(0)
    expect(cleaned({ split: '100' }).split).toBe(1)
    expect(cleaned({ split: '' }).split).toBe(0)
  })

  it('stops at both ends of the percentage', () => {
    expect(refusal({ split: '100.1' }).split).toBe(why)
    expect(refusal({ split: '-1' }).split).toBe(why)
  })

  /**
   * Junk is refused, not read as zero. Every one of these figures reaches a
   * settlement and then a person; the same reasoning as `cleanDoor` in
   * `src/lib/actuals.ts`. Do not clamp — refuse.
   */
  it.each(['12abc', 'NaN', 'Infinity', '1e999'])('refuses %j rather than reading it as 0', (v) => {
    expect(refusal({ split: v }).split).toBe(why)
  })
})

describe('the attendance spread', () => {
  const NOT_WHOLE = 'Attendance is a head count — whole numbers.'
  const OUT_OF_ORDER = 'Attendance runs quiet, likely, great — each at least the one before.'

  it('is three head counts, blank reading as none', () => {
    expect(cleaned({ attQuiet: '88', attLikely: '136', attGreat: '198' }).att).toEqual([
      88, 136, 198,
    ])
    expect(cleaned({ attQuiet: '', attLikely: '', attGreat: '' }).att).toEqual([0, 0, 0])
  })

  it('counts whole people', () => {
    expect(refusal({ attLikely: '12.5' }).att).toBe(NOT_WHOLE)
    expect(refusal({ attQuiet: '-1' }).att).toBe(NOT_WHOLE)
  })

  it.each(['12abc', 'NaN', 'Infinity', '1e999'])('refuses %j rather than reading it as 0', (v) => {
    expect(refusal({ attGreat: v }).att).toBe(NOT_WHOLE)
  })

  it('runs quiet, likely, great', () => {
    expect(refusal({ attQuiet: '150', attLikely: '100', attGreat: '198' }).att).toBe(OUT_OF_ORDER)
    expect(refusal({ attQuiet: '88', attLikely: '198', attGreat: '136' }).att).toBe(OUT_OF_ORDER)
  })

  it('will not put more people in the room than fit', () => {
    expect(cleaned({ attGreat: '220' }).att).toEqual([88, 136, 220])
    expect(refusal({ attGreat: '221' }).att).toBe(
      'Main holds 220 — a great night cannot be more than that.',
    )
  })

  it('counts the seats when the room is set as cabaret', () => {
    // Cabaret is the one seated format — `capacityOf` in ticketing.ts.
    expect(cleaned({ format: 'Cabaret', attGreat: '150' }).att).toEqual([88, 136, 150])
    expect(refusal({ format: 'Cabaret', attGreat: '151' }).att).toBe(
      'Main holds 150 seated — a great night cannot be more than that.',
    )
  })

  it('says nothing about capacity when it does not know the room', () => {
    // One problem per field: the room is what is wrong here, and an invented
    // capacity error on top of it would send somebody to the wrong control.
    const errors = refusal({ spaceId: 'space_nope', attGreat: '9999' })
    expect(errors.spaceId).toBe('Pick the room this is booked into.')
    expect(errors.att).toBeUndefined()
  })
})

describe('the money and the crew', () => {
  const DOLLARS = 'That is a dollar figure, zero or more.'
  const WHOLE = 'Crew and tokens are whole numbers, zero or more.'

  it('reads blank bar spend, gear and promotion as nothing', () => {
    const value = cleaned({ barHead: '', gear: '', adv: '' })
    expect([value.barHead, value.gear, value.adv]).toEqual([0, 0, 0])
  })

  it('wants a dollar figure in each of them', () => {
    expect(refusal({ barHead: 'abc' }).barHead).toBe(DOLLARS)
    expect(refusal({ gear: '-1' }).gear).toBe(DOLLARS)
    expect(refusal({ adv: 'Infinity' }).adv).toBe(DOLLARS)
    expect(refusal({ gear: '100001' }).gear).toBe(DOLLARS)
    expect(cleaned({ gear: '100000' }).gear).toBe(100000)
  })

  it('starts on the in-house system and takes only a system the venue has', () => {
    expect(cleaned({ sound: '' }).sound).toBe('inhouse')
    expect(cleaned({ sound: 'wheke' }).sound).toBe('wheke')
    expect(refusal({ sound: 'pa' }).sound).toBe('Pick the sound system.')
  })

  it('counts crew and tokens in whole numbers, within what a night uses', () => {
    expect(cleaned({ crew: '', tok: '' }).crew).toBe(0)
    expect(cleaned({ crew: '100', tok: '20' }).tok).toBe(20)
    expect(refusal({ crew: '6.5' }).crew).toBe(WHOLE)
    expect(refusal({ crew: '-1' }).crew).toBe(WHOLE)
    expect(refusal({ crew: '101' }).crew).toBe(WHOLE)
    expect(refusal({ tok: '21' }).tok).toBe(WHOLE)
    expect(refusal({ tok: 'lots' }).tok).toBe(WHOLE)
  })
})

describe('the hold', () => {
  it('is whatever the coordinator ticked', () => {
    expect(cleaned({ hold: true }).hold).toBe(true)
    expect(cleaned({ hold: false }).hold).toBe(false)
  })
})

// ------------------------------------------------- reporting the problems ---

describe('reporting the problems', () => {
  it('reports every field that is wrong, not only the first', () => {
    // Somebody who has to fix one thing per submit gives up on the form.
    expect(refusal({ name: '', kind: 'rave', split: 'lots', crew: '-2' })).toEqual({
      name: 'Give the event a name — it is what every screen calls it.',
      kind: 'Say what kind of night it is — it drives the roster.',
      split: 'The split is a percentage from 0 to 100.',
      crew: 'Crew and tokens are whole numbers, zero or more.',
    })
  })

  it('walks the fields in the order the form asks them', () => {
    expect([...FIELD_ORDER]).toEqual([
      'name',
      'date',
      'spaceId',
      'kind',
      'format',
      'doors',
      'barClose',
      'allOut',
      'endDate',
      'acts',
      'note',
      'alternates',
      'ownerId',
      'model',
      'std',
      'door',
      'mix',
      'bringing',
      'organisationId',
      'promoterName',
      'split',
      'att',
      'barHead',
      'gear',
      'adv',
      'sound',
      'crew',
      'tok',
      'brief',
    ])
  })

  it('says the first problem in form order, whichever was found first', () => {
    // The toast names one thing, and it should be the one nearest the top of
    // the form rather than whichever check happened to run first.
    expect(firstError({ crew: 'c', name: 'n' })).toBe('n')
    expect(firstError({ tok: 't', att: 'a' })).toBe('a')
  })

  it('has nothing to say when nothing is wrong', () => {
    expect(firstError({})).toBeNull()
  })
})

// ---------------------------------------------------- the permission rule ---

/**
 * THE rule of this file.
 *
 * An outside promoter opens the same form through the same module and posts to
 * the same action. Everything they may not set is FIXED here, on the server,
 * out of a whitelist of raw fields — not hidden from their view of the form.
 * The POST body is theirs to write, so nothing that reaches a figure on the
 * P&L, names an owner, claims another organisation or holds a room may come
 * out of it.
 */
describe('an outside account', () => {
  /** Everything a promoter could put in the POST if they wrote it by hand. */
  const hostile = (over: Partial<RawEnquiry> = {}): Partial<RawEnquiry> => ({
    dateTbc: false,
    ownerId: 'person_ana',
    model: 'dry',
    bringing: 'organisation',
    organisationId: 'org_somebody_else',
    promoterName: 'Somebody Else Presents',
    split: '100',
    endDate: '2026-10-05',
    std: '35',
    door: '45',
    mixSub: '10',
    mixStd: '50',
    mixSup: '15',
    mixDoor: '25',
    attQuiet: '200',
    attLikely: '210',
    attGreat: '220',
    barHead: '99',
    gear: '9000',
    adv: '9000',
    sound: 'wheke',
    crew: '40',
    tok: '20',
    brief: 'put us on the good system',
    hold: true,
    acts: [
      { name: 'Hiwa', status: 'confirmed', low: '900', high: '1800' },
      { name: 'Tautoko', status: 'confirmed', low: '400', high: '800' },
    ],
    ...over,
  })

  it('builds the enquiry from a whitelist, whatever the POST said — and keeps what they proposed', () => {
    expect(cleaned(hostile(), outside)).toEqual({
      // Theirs to say: the night, the room, what it is, who is on — and now
      // every input the live model reads, as their proposal.
      name: 'Kōura Records presents Hiwa',
      date: NIGHT,
      spaceId: 'space_main',
      kind: 'live',
      format: 'Live music',
      doors: '8:00pm',
      barClose: '1:00am',
      allOut: '2:00am',
      endDate: nightOf(2026, 9, 5),
      model: 'dry',
      std: 35,
      door: 45,
      mix: [0.1, 0.5, 0.15, 0.25],
      att: [200, 210, 220],
      barHead: 99,
      gear: 9000,
      adv: 9000,
      sound: 'wheke',
      crew: 40,
      tok: 20,
      acts: [
        { name: 'Hiwa', status: 'enquired', low: 900, high: 1800 },
        { name: 'Tautoko', status: 'enquired', low: 400, high: 800 },
      ],
      note: 'They want the back bar open.',
      alternates: [],
      // The venue's, whatever they sent. Their date is a preference until a
      // coordinator locks it; their organisation is the one on their session.
      dateTbc: true,
      ownerId: null,
      bringing: { by: 'organisation', organisationId: 'org_koura' },
      split: 0.6,
      brief: null,
      hold: false,
    })
  })

  it('cannot claim somebody else’s organisation', () => {
    expect(cleaned(hostile(), outside).bringing).toEqual({
      by: 'organisation',
      organisationId: 'org_koura',
    })
  })

  it('cannot hand the booking to the venue either', () => {
    expect(cleaned(hostile({ bringing: 'venue' }), outside).bringing).toEqual({
      by: 'organisation',
      organisationId: 'org_koura',
    })
  })

  it('cannot hold the room', () => {
    // A hold is the venue's to give. A promoter who could place one could
    // block every Saturday of the summer from their kitchen table.
    expect(cleaned(hostile(), outside).hold).toBe(false)
  })

  it('still fixes what is not theirs to set, whatever they sent', () => {
    const value = cleaned(hostile(), outside)
    expect(value.split).toBe(0.6)
    expect(value.ownerId).toBeNull()
    expect(value.brief).toBeNull()
    expect(value.hold).toBe(false)
    expect(value.dateTbc).toBe(true)
    expect(value.acts.every((a) => a.status === 'enquired')).toBe(true)
  })

  /**
   * A field the form never showed them can hold anything. Refusing it would be
   * a validation error about a value that is thrown away — it would stop an
   * enquiry over a number nobody is ever going to read.
   */
  it('is not even validated on the fields it never gets to set', () => {
    const value = cleaned(
      hostile({
        split: 'abc',
        bringing: 'nonsense',
        organisationId: '',
        promoterName: '',
        ownerId: 'not_a_real_person',
        brief: chars(281),
        hold: true,
      }),
      outside,
    )
    expect(value.split).toBe(0.6)
    expect(value.ownerId).toBeNull()
    expect(value.brief).toBeNull()
    expect(value.hold).toBe(false)
  })

  /**
   * Everything else they typed is now their proposal, corrected by the venue
   * afterwards rather than trusted outright — so junk in it is refused with
   * the exact words a coordinator would read for the same mistake.
   */
  it('is refused, the same as the venue, for junk in a figure they DO set', () => {
    expect(refusal(hostile({ attQuiet: 'x' }), outside).att).toBe(
      'Attendance is a head count — whole numbers.',
    )
    expect(refusal(hostile({ std: '-5' }), outside).std).toBe(
      'A ticket price is a dollar figure, zero or more.',
    )
    expect(refusal(hostile({ mixStd: '40' }), outside).mix).toBe(
      'The mix has to add up to 100% — everybody who comes buys one of the four.',
    )
    expect(
      refusal(
        hostile({ acts: [{ name: 'Hiwa', status: 'confirmed', low: '900', high: '400' }] }),
        outside,
      ).acts,
    ).toBe("An act's top fee cannot be under its floor.")
    expect(refusal(hostile({ model: 'freehold' }), outside).model).toBe(
      'Pick how the venue and the promoter are working together.',
    )
  })

  /** The fields they DO set are still theirs to get wrong. */
  const whitelisted: [string, Partial<RawEnquiry>, FieldKey, string][] = [
    [
      'a name too short to call it by',
      { name: 'x' },
      'name',
      'Give the event a name — it is what every screen calls it.',
    ],
    [
      'a night that has already been',
      { date: nights(-1) },
      'date',
      'That night has already been — pick one still to come.',
    ],
    [
      'a kind of night nobody rosters',
      { kind: 'rave' },
      'kind',
      'Say what kind of night it is — it drives the roster.',
    ],
  ]

  it.each(whitelisted)('still refuses %s', (_, over, field, why) => {
    expect(refusal(over, outside)[field]).toBe(why)
  })

  it('has nowhere to put an enquiry from an account with no organisation', () => {
    const out = cleanEnquiry(raw(), ctx({ user: outsideNoOrg }))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.errors).toEqual({ organisationId: NO_ORGANISATION })
  })
})

// ----------------------------------------------------------------- words ---

describe('internalContact', () => {
  it('names the coordinator the way the seed writes it', () => {
    expect(internalContact('Ana Kelliher')).toBe('internal · Ana Kelliher')
  })

  it('says so plainly when nobody has claimed it', () => {
    // What the "Booking contact named" gate reads, and what puts the event in
    // the unclaimed queue on Home.
    expect(internalContact(null)).toBe('internal · unassigned')
  })
})

describe('startedLine', () => {
  /**
   * `dateLabel` reads local getters, so the label is built the same way the
   * line builds it rather than hard-coded — UTC and Pacific/Auckland agree on
   * a night, but the test should not care which one is running it.
   */
  const label = dateLabel(NIGHT)
  const NOTE = 'They want the back bar open.'
  const ALT1 = nightOf(2026, 9, 10)
  const ALT2 = nightOf(2026, 9, 17)

  const line = (over: Partial<Parameters<typeof startedLine>[0]> = {}): string =>
    startedLine({
      external: false,
      organisationName: null,
      spaceName: 'Main',
      date: NIGHT,
      dateTbc: false,
      note: null,
      alternates: [],
      ...over,
    })

  it('says what a coordinator started, where and when', () => {
    expect(line()).toBe(`started this enquiry — Main, ${label}`)
  })

  it('says when the date is only a best guess', () => {
    expect(line({ dateTbc: true })).toBe(`started this enquiry — Main, ${label}, date TBC`)
  })

  it('says the enquiry came in from outside, and who from', () => {
    expect(line({ external: true, organisationName: 'Kōura Records', dateTbc: true })).toBe(
      `sent this enquiry for Kōura Records — Main, preferred date ${label}`,
    )
  })

  it('repeats the note in their own words', () => {
    // Verbatim, in quotes, because it is the one bit of the enquiry nobody
    // else wrote.
    expect(line({ note: NOTE })).toBe(`started this enquiry — Main, ${label} — “${NOTE}”`)
    expect(line({ dateTbc: true, note: NOTE })).toBe(
      `started this enquiry — Main, ${label}, date TBC — “${NOTE}”`,
    )
    expect(
      line({ external: true, organisationName: 'Kōura Records', dateTbc: true, note: NOTE }),
    ).toBe(`sent this enquiry for Kōura Records — Main, preferred date ${label} — “${NOTE}”`)
  })

  it('names one alternate straight after the preferred date', () => {
    expect(line({ alternates: [ALT1] })).toBe(
      `started this enquiry — Main, ${label} (or ${dateLabel(ALT1)})`,
    )
  })

  it('names both alternates, before "date TBC"', () => {
    expect(line({ alternates: [ALT1, ALT2], dateTbc: true })).toBe(
      `started this enquiry — Main, ${label} (or ${dateLabel(ALT1)} or ${dateLabel(ALT2)}), date TBC`,
    )
  })

  it('puts the alternates after the preferred date for an outside account too', () => {
    expect(line({ external: true, organisationName: 'Kōura Records', alternates: [ALT1] })).toBe(
      `sent this enquiry for Kōura Records — Main, preferred date ${label} (or ${dateLabel(ALT1)})`,
    )
  })
})

describe('startedSaid', () => {
  it('tells a promoter what happens next, not what was saved', () => {
    expect(startedSaid({ external: true, hasOwner: false, dateTbc: true })).toEqual({
      kind: 'good',
      text: 'Sent — it is with the venue now. A coordinator will pick it up and settle the date with you.',
    })
  })

  it('says an owned, dated enquiry is free to move on', () => {
    expect(startedSaid({ external: false, hasOwner: true, dateTbc: false })).toEqual({
      kind: 'good',
      text: 'Enquiry started — nothing holds it at Enquiry, so it can move to Negotiating when you are ready.',
    })
  })

  it('names what is holding it at Enquiry', () => {
    expect(startedSaid({ external: false, hasOwner: false, dateTbc: false })).toEqual({
      kind: 'good',
      text: 'Enquiry started — it waits at Enquiry until somebody owns it.',
    })
    expect(startedSaid({ external: false, hasOwner: true, dateTbc: true })).toEqual({
      kind: 'good',
      text: 'Enquiry started — it waits at Enquiry until the date is locked.',
    })
  })

  it('names both when both are missing', () => {
    expect(startedSaid({ external: false, hasOwner: false, dateTbc: true })).toEqual({
      kind: 'good',
      text: 'Enquiry started — it waits at Enquiry until somebody owns it and the date is locked.',
    })
  })
})

// ------------------------------------------------------------- the form ---

describe('the form field names', () => {
  it('are what the inputs are called', () => {
    expect(FIELD).toEqual({
      name: 'name',
      date: 'date',
      dateTbc: 'dateTbc',
      spaceId: 'spaceId',
      kind: 'kind',
      format: 'format',
      doors: 'doors',
      barClose: 'barClose',
      allOut: 'allOut',
      endDate: 'endDate',
      model: 'model',
      std: 'std',
      door: 'door',
      mixSub: 'mixSub',
      mixStd: 'mixStd',
      mixSup: 'mixSup',
      mixDoor: 'mixDoor',
      attQuiet: 'attQuiet',
      attLikely: 'attLikely',
      attGreat: 'attGreat',
      barHead: 'barHead',
      gear: 'gear',
      adv: 'adv',
      sound: 'sound',
      crew: 'crew',
      tok: 'tok',
      actName: 'actName',
      actStatus: 'actStatus',
      actLow: 'actLow',
      actHigh: 'actHigh',
      note: 'note',
      alt1: 'alt1',
      alt2: 'alt2',
      ownerId: 'ownerId',
      bringing: 'bringing',
      organisationId: 'organisationId',
      promoterName: 'promoterName',
      split: 'split',
      brief: 'brief',
      hold: 'hold',
    })
  })
})

describe('readEnquiryForm', () => {
  /** A full submit, one distinct value per field. */
  const posted = (): FormData => {
    const fd = new FormData()
    fd.set(FIELD.name, 'Kōura Records presents Hiwa')
    fd.set(FIELD.date, '2026-10-03')
    fd.set(FIELD.dateTbc, 'on')
    fd.set(FIELD.spaceId, 'space_main')
    fd.set(FIELD.kind, 'live')
    fd.set(FIELD.format, 'Live music')
    fd.set(FIELD.doors, '20:00')
    fd.set(FIELD.barClose, '01:00')
    fd.set(FIELD.allOut, '02:00')
    fd.set(FIELD.endDate, '2026-10-04')
    fd.set(FIELD.model, 'curator')
    fd.set(FIELD.std, '25')
    fd.set(FIELD.door, '30')
    fd.set(FIELD.mixSub, '20')
    fd.set(FIELD.mixStd, '40')
    fd.set(FIELD.mixSup, '15')
    fd.set(FIELD.mixDoor, '25')
    fd.set(FIELD.attQuiet, '88')
    fd.set(FIELD.attLikely, '136')
    fd.set(FIELD.attGreat, '198')
    fd.set(FIELD.barHead, '20')
    fd.set(FIELD.gear, '200')
    fd.set(FIELD.adv, '100')
    fd.set(FIELD.sound, 'inhouse')
    fd.set(FIELD.crew, '6')
    fd.set(FIELD.tok, '2')
    fd.set(FIELD.note, 'They want the back bar open.')
    const acts: RawAct[] = [
      { name: 'Hiwa', status: 'confirmed', low: '400', high: '900' },
      { name: 'Tautoko', status: 'pencilled', low: '250', high: '500' },
    ]
    for (const a of acts) {
      fd.append(FIELD.actName, a.name)
      fd.append(FIELD.actStatus, a.status)
      fd.append(FIELD.actLow, a.low)
      fd.append(FIELD.actHigh, a.high)
    }
    fd.set(FIELD.alt1, '2026-10-10')
    fd.set(FIELD.alt2, '2026-10-17')
    fd.set(FIELD.ownerId, 'person_ana')
    fd.set(FIELD.bringing, 'organisation')
    fd.set(FIELD.organisationId, 'org_koura')
    fd.set(FIELD.promoterName, 'Kōura Records')
    fd.set(FIELD.split, '62')
    fd.set(FIELD.brief, 'Loud, warm, local.')
    fd.set(FIELD.hold, 'on')
    return fd
  }

  it('reads every field the form posts', () => {
    expect(readEnquiryForm(posted())).toEqual({
      name: 'Kōura Records presents Hiwa',
      date: '2026-10-03',
      dateTbc: true,
      spaceId: 'space_main',
      kind: 'live',
      format: 'Live music',
      doors: '20:00',
      barClose: '01:00',
      allOut: '02:00',
      endDate: '2026-10-04',
      model: 'curator',
      std: '25',
      door: '30',
      mixSub: '20',
      mixStd: '40',
      mixSup: '15',
      mixDoor: '25',
      attQuiet: '88',
      attLikely: '136',
      attGreat: '198',
      barHead: '20',
      gear: '200',
      adv: '100',
      sound: 'inhouse',
      crew: '6',
      tok: '2',
      acts: [
        { name: 'Hiwa', status: 'confirmed', low: '400', high: '900' },
        { name: 'Tautoko', status: 'pencilled', low: '250', high: '500' },
      ],
      note: 'They want the back bar open.',
      alt1: '2026-10-10',
      alt2: '2026-10-17',
      ownerId: 'person_ana',
      bringing: 'organisation',
      organisationId: 'org_koura',
      promoterName: 'Kōura Records',
      split: '62',
      brief: 'Loud, warm, local.',
      hold: true,
    })
  })

  it('hands the values over exactly as typed — the tidying is cleanEnquiry’s job', () => {
    const fd = posted()
    fd.set(FIELD.name, '  Kōura  Records ')
    expect(readEnquiryForm(fd).name).toBe('  Kōura  Records ')
  })

  it('zips the four act lists by row, padding a short list', () => {
    // The rows are four parallel lists, and a row whose fee input was removed
    // from the DOM would otherwise shift every act below it onto the wrong fee.
    const fd = new FormData()
    for (const n of ['Hiwa', 'Tautoko', 'Pōhutu']) fd.append(FIELD.actName, n)
    fd.append(FIELD.actStatus, 'confirmed')
    fd.append(FIELD.actLow, '400')
    fd.append(FIELD.actLow, '250')

    expect(readEnquiryForm(fd).acts).toEqual([
      { name: 'Hiwa', status: 'confirmed', low: '400', high: '' },
      { name: 'Tautoko', status: '', low: '250', high: '' },
      { name: 'Pōhutu', status: '', low: '', high: '' },
    ])
  })

  it('takes a checkbox as ticked only when the browser says "on"', () => {
    const fd = posted()
    fd.set(FIELD.dateTbc, 'true')
    fd.set(FIELD.hold, '1')
    const out = readEnquiryForm(fd)
    expect(out.dateTbc).toBe(false)
    expect(out.hold).toBe(false)
  })

  it('reads an empty submit as an empty form rather than throwing', () => {
    expect(readEnquiryForm(new FormData())).toEqual({
      name: '',
      date: '',
      dateTbc: false,
      spaceId: '',
      kind: '',
      format: '',
      doors: '',
      barClose: '',
      allOut: '',
      endDate: '',
      model: '',
      std: '',
      door: '',
      mixSub: '',
      mixStd: '',
      mixSup: '',
      mixDoor: '',
      attQuiet: '',
      attLikely: '',
      attGreat: '',
      barHead: '',
      gear: '',
      adv: '',
      sound: '',
      crew: '',
      tok: '',
      acts: [],
      note: '',
      alt1: '',
      alt2: '',
      ownerId: '',
      bringing: '',
      organisationId: '',
      promoterName: '',
      split: '',
      brief: '',
      hold: false,
    })
  })

  it('reads a file posted where a string belongs as nothing', () => {
    // A multipart body can carry a File under any name it likes. Reading one
    // as a string would put "[object File]" on the pipeline.
    const fd = posted()
    fd.set(FIELD.name, new File(['not a name'], 'poster.jpg'))
    expect(readEnquiryForm(fd).name).toBe('')
  })
})
