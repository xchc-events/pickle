import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'

/**
 * Tech's per-act mutations.
 *
 * Connor, 23 Sep 2026: "The only details we want to see here are tech riders
 * and stage plots. These two want to be per artist, and you can have a
 * section for the promoter as well." An `artistId` a caller supplies is
 * re-checked against the event the same way `eventId` itself is — a POST
 * endpoint has to survive being asked about somebody else's act.
 */

const requireModule = vi.fn()
const requireEvent = vi.fn()
vi.mock('@/lib/permissions', () => ({
  requireModule: (...a: unknown[]) => requireModule(...a),
  requireEvent: (...a: unknown[]) => requireEvent(...a),
}))

const findArtist = vi.fn()
const findFile = vi.fn()
const findEvent = vi.fn()
const createVenueSpecSend = vi.fn()
const createRunSheetSend = vi.fn()
vi.mock('@/lib/db', () => ({
  db: {
    eventArtist: { findUnique: (...a: unknown[]) => findArtist(...a) },
    storedFile: { findUnique: (...a: unknown[]) => findFile(...a) },
    event: { findUniqueOrThrow: (...a: unknown[]) => findEvent(...a) },
    venueSpecSend: { create: (...a: unknown[]) => createVenueSpecSend(...a) },
    runSheetSend: { create: (...a: unknown[]) => createRunSheetSend(...a) },
  },
}))

const begin = vi.fn()
const attachToArtist = vi.fn()
vi.mock('@/lib/files-data', () => ({
  begin: (...a: unknown[]) => begin(...a),
  attachToArtist: (...a: unknown[]) => attachToArtist(...a),
}))

const eventRecipients = vi.fn()
vi.mock('@/lib/tech-data', () => ({
  eventRecipients: (...a: unknown[]) => eventRecipients(...a),
}))

const loadVenueSpecComponents = vi.fn()
vi.mock('@/lib/venue-spec-data', () => ({
  loadVenueSpecComponents: (...a: unknown[]) => loadVenueSpecComponents(...a),
}))

const runSheetFor = vi.fn()
const saveRunSheetRows = vi.fn()
vi.mock('@/lib/run-sheet-data', () => ({
  runSheetFor: (...a: unknown[]) => runSheetFor(...a),
  saveRunSheetRows: (...a: unknown[]) => saveRunSheetRows(...a),
}))

const sendMail = vi.fn()
vi.mock('@/lib/email', () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }))

const record = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...a: unknown[]) => record(...a) }))
vi.mock('next/cache', () => ({ refresh: vi.fn() }))

const {
  beginTechUpload,
  beginPromoterUpload,
  assignFileToArtist,
  sendVenueSpec,
  saveRunSheet,
  sendRunSheet,
} = await import('./actions')

const tui = {
  id: 'user_tui',
  email: 'tui@xchc.test',
  name: 'Tui Ware',
  role: 'TECH',
  roleKey: 'tech',
  organisationId: null,
  organisationName: null,
  external: false,
  personId: 'person_tui',
  initials: 'TW',
  authenticated: true,
  sessionId: 'session_tui',
} satisfies SessionUser

const EVENT = 'evt_wax_lyrical'
const OTHER_EVENT = 'evt_other'

beforeEach(() => {
  vi.clearAllMocks()
  requireModule.mockResolvedValue({ user: tui, modules: ['tech'] })
  requireEvent.mockResolvedValue(EVENT)
  begin.mockResolvedValue({ ok: true, fileId: 'file_1', url: 'https://r2.example/put' })
  sendMail.mockResolvedValue('sent')
  createVenueSpecSend.mockResolvedValue({ id: 'vss_1' })
  createRunSheetSend.mockResolvedValue({ id: 'rss_1' })
})

describe('starting an act’s rider or stage plot', () => {
  it('passes the act straight through once it checks out', async () => {
    findArtist.mockResolvedValue({ eventId: EVENT })

    const out = await beginTechUpload(
      EVENT,
      'RIDER_TECH',
      'art_1',
      'rider.pdf',
      'application/pdf',
      1024,
    )

    expect(out.ok).toBe(true)
    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: EVENT, artistId: 'art_1', kind: 'RIDER_TECH' }),
    )
  })

  it('refuses an act that belongs to a different event', async () => {
    findArtist.mockResolvedValue({ eventId: OTHER_EVENT })

    const out = await beginTechUpload(
      EVENT,
      'RIDER_TECH',
      'art_1',
      'rider.pdf',
      'application/pdf',
      1024,
    )

    expect(out.ok).toBe(false)
    expect(out.why).toMatch(/not on this event/)
    expect(begin).not.toHaveBeenCalled()
  })

  it('refuses an act id that does not exist at all', async () => {
    findArtist.mockResolvedValue(null)

    const out = await beginTechUpload(
      EVENT,
      'RIDER_TECH',
      'art_ghost',
      'rider.pdf',
      'application/pdf',
      1024,
    )

    expect(out.ok).toBe(false)
    expect(begin).not.toHaveBeenCalled()
  })

  it('needs no act at all for the venue spec', async () => {
    const out = await beginTechUpload(EVENT, 'TECH_SPEC', null, 'spec.pdf', 'application/pdf', 1024)

    expect(out.ok).toBe(true)
    expect(findArtist).not.toHaveBeenCalled()
    expect(begin).toHaveBeenCalledWith(expect.objectContaining({ artistId: null }))
  })
})

describe('starting the promoter’s own upload', () => {
  it('files it against the event’s promoter payee', async () => {
    findEvent.mockResolvedValue({ promoterId: 'pay_promo' })

    const out = await beginPromoterUpload(EVENT, 'RIDER_TECH', 'rider.pdf', 'application/pdf', 1024)

    expect(out.ok).toBe(true)
    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({ payeeId: 'pay_promo', eventId: EVENT }),
    )
  })

  it('refuses when the event has no promoter payee to file it against', async () => {
    findEvent.mockResolvedValue({ promoterId: null })

    const out = await beginPromoterUpload(EVENT, 'RIDER_TECH', 'rider.pdf', 'application/pdf', 1024)

    expect(out.ok).toBe(false)
    expect(begin).not.toHaveBeenCalled()
  })
})

describe('attaching an unassigned file to an act', () => {
  it('writes the act once both check out', async () => {
    findFile.mockResolvedValue({ eventId: EVENT, name: 'rider.pdf' })
    findArtist.mockResolvedValue({ eventId: EVENT, name: 'Static Bloom' })
    attachToArtist.mockResolvedValue({ ok: true })

    const out = await assignFileToArtist(EVENT, 'file_1', 'art_1')

    expect(out.kind).toBe('good')
    expect(attachToArtist).toHaveBeenCalledWith('file_1', 'art_1')
    expect(record).toHaveBeenCalledWith(EVENT, tui, expect.stringContaining('Static Bloom'))
  })

  it('refuses a file that is not on this event', async () => {
    findFile.mockResolvedValue({ eventId: OTHER_EVENT, name: 'rider.pdf' })
    findArtist.mockResolvedValue({ eventId: EVENT, name: 'Static Bloom' })

    const out = await assignFileToArtist(EVENT, 'file_1', 'art_1')

    expect(out.kind).toBe('stop')
    expect(attachToArtist).not.toHaveBeenCalled()
  })

  it('refuses an act that is not on this event', async () => {
    findFile.mockResolvedValue({ eventId: EVENT, name: 'rider.pdf' })
    findArtist.mockResolvedValue({ eventId: OTHER_EVENT, name: 'Static Bloom' })

    const out = await assignFileToArtist(EVENT, 'file_1', 'art_1')

    expect(out.kind).toBe('stop')
    expect(attachToArtist).not.toHaveBeenCalled()
  })

  it('passes on the reason files-data refuses for, e.g. a file already on an act', async () => {
    findFile.mockResolvedValue({ eventId: EVENT, name: 'rider.pdf' })
    findArtist.mockResolvedValue({ eventId: EVENT, name: 'Static Bloom' })
    attachToArtist.mockResolvedValue({ ok: false, why: 'That file is already on an act.' })

    const out = await assignFileToArtist(EVENT, 'file_1', 'art_1')

    expect(out.kind).toBe('stop')
    expect(out.text).toBe('That file is already on an act.')
  })
})

/**
 * Sending the venue spec.
 *
 * Connor, 23 Sep 2026: "It'd be better to have a more full-featured option
 * where you can select which components of a venue spec sheet you're
 * sending out, as not all of them are relevant to all people." Both
 * refusals worth a name check: a component set that assembles to nothing,
 * and a recipient ticked with no email on file.
 */
describe('sending the venue spec', () => {
  const COMPONENTS = [
    {
      key: 'room',
      title: 'Room dimensions and capacity',
      body: '12m x 8m.',
      order: 0,
      active: true,
    },
    { key: 'stage', title: 'Stage', body: '6m x 4m.', order: 1, active: true },
  ]
  const RECIPIENTS = [
    {
      payeeId: 'pay_act',
      name: 'Static Bloom',
      email: 'static@example.test',
      kind: 'act' as const,
    },
    { payeeId: 'pay_promo', name: 'Kōura Records', email: null, kind: 'promoter' as const },
  ]

  beforeEach(() => {
    findEvent.mockResolvedValue({ name: 'Static Bloom @ XCHC' })
    loadVenueSpecComponents.mockResolvedValue(COMPONENTS)
    eventRecipients.mockResolvedValue(RECIPIENTS)
  })

  it('is refused for external users and for anyone without the tech module, the same as every other action here', async () => {
    requireModule.mockRejectedValue(new Error('not found'))

    await expect(sendVenueSpec(EVENT, ['room'], ['pay_act'])).rejects.toThrow()
    expect(sendMail).not.toHaveBeenCalled()
    expect(createVenueSpecSend).not.toHaveBeenCalled()
  })

  it('sends exactly the ticked components, in house order, to every ticked recipient', async () => {
    const out = await sendVenueSpec(EVENT, ['stage', 'room'], ['pay_act'])

    expect(out.kind).toBe('good')
    expect(sendMail).toHaveBeenCalledTimes(1)
    const [to, mail] = sendMail.mock.calls[0]!
    expect(to).toBe('static@example.test')
    expect(mail.text.indexOf('Room dimensions and capacity')).toBeLessThan(
      mail.text.indexOf('Stage'),
    )
    expect(createVenueSpecSend).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: EVENT,
          componentKeys: ['room', 'stage'],
          payeeIds: ['pay_act'],
          sentById: tui.personId,
        }),
      }),
    )
  })

  it('records a send and writes an activity line', async () => {
    await sendVenueSpec(EVENT, ['room'], ['pay_act'])

    expect(createVenueSpecSend).toHaveBeenCalled()
    expect(record).toHaveBeenCalledWith(EVENT, tui, expect.stringContaining('Static Bloom'))
  })

  it('refuses a recipient with no email on file, naming them', async () => {
    const out = await sendVenueSpec(EVENT, ['room'], ['pay_promo'])

    expect(out.kind).toBe('stop')
    expect(out.text).toContain('Kōura Records')
    expect(sendMail).not.toHaveBeenCalled()
    expect(createVenueSpecSend).not.toHaveBeenCalled()
  })

  it('refuses a recipient who is not on this event', async () => {
    const out = await sendVenueSpec(EVENT, ['room'], ['pay_stranger'])

    expect(out.kind).toBe('stop')
    expect(createVenueSpecSend).not.toHaveBeenCalled()
  })

  it('refuses when nothing is ticked to send', async () => {
    const out = await sendVenueSpec(EVENT, [], ['pay_act'])

    expect(out.kind).toBe('stop')
    expect(createVenueSpecSend).not.toHaveBeenCalled()
  })

  it('refuses when no recipient is ticked', async () => {
    const out = await sendVenueSpec(EVENT, ['room'], [])

    expect(out.kind).toBe('stop')
    expect(createVenueSpecSend).not.toHaveBeenCalled()
  })
})

/**
 * The run sheet: saving it, and sending it to the promoter.
 *
 * Connor, 23 Sep 2026: "A section here which allows you to fill in a run
 * sheet, like a tech run sheet, would be really helpful. And then sending
 * that to the promoter."
 */
describe('saving the run sheet', () => {
  it('is refused for external users and for anyone without the tech module', async () => {
    requireModule.mockRejectedValue(new Error('not found'))

    await expect(
      saveRunSheet(EVENT, [{ time: '8:00pm', item: 'Doors', who: null, note: null }]),
    ).rejects.toThrow()
    expect(saveRunSheetRows).not.toHaveBeenCalled()
  })

  it('saves the rows in order and records an activity line', async () => {
    const rows = [
      { time: '3:00pm', item: 'Pack-in', who: 'Crew', note: null },
      { time: '8:00pm', item: 'Doors', who: null, note: null },
    ]

    const out = await saveRunSheet(EVENT, rows)

    expect(out.kind).toBe('good')
    expect(saveRunSheetRows).toHaveBeenCalledWith(EVENT, rows)
    expect(record).toHaveBeenCalledWith(EVENT, tui, expect.stringContaining('run sheet'))
  })

  it('drops a row nobody put a name to, rather than saving a blank one', async () => {
    const rows = [
      { time: '8:00pm', item: 'Doors', who: null, note: null },
      { time: null, item: '   ', who: null, note: null },
    ]

    await saveRunSheet(EVENT, rows)

    expect(saveRunSheetRows).toHaveBeenCalledWith(EVENT, [
      { time: '8:00pm', item: 'Doors', who: null, note: null },
    ])
  })
})

describe('sending the run sheet to the promoter', () => {
  const ROWS = [
    { id: '1', time: '3:00pm', item: 'Pack-in', who: 'Crew', note: null, order: 0 },
    { id: '2', time: '8:00pm', item: 'Doors', who: null, note: null, order: 1 },
  ]
  const RECIPIENTS = [
    {
      payeeId: 'pay_act',
      name: 'Static Bloom',
      email: 'static@example.test',
      kind: 'act' as const,
    },
    {
      payeeId: 'pay_promo',
      name: 'Kōura Records',
      email: 'promo@example.test',
      kind: 'promoter' as const,
    },
  ]

  beforeEach(() => {
    findEvent.mockResolvedValue({
      name: 'Static Bloom @ XCHC',
      packIn: '3:00pm',
      doors: '8:00pm',
      barClose: null,
      allOut: null,
      packOut: null,
    })
    runSheetFor.mockResolvedValue(ROWS)
    eventRecipients.mockResolvedValue(RECIPIENTS)
  })

  it('is refused for external users and for anyone without the tech module', async () => {
    requireModule.mockRejectedValue(new Error('not found'))

    await expect(sendRunSheet(EVENT, [])).rejects.toThrow()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('always sends to the promoter, and to any act ticked alongside them', async () => {
    const out = await sendRunSheet(EVENT, ['pay_act'])

    expect(out.kind).toBe('good')
    expect(sendMail).toHaveBeenCalledTimes(2)
    const to = sendMail.mock.calls.map((c) => c[0]).sort()
    expect(to).toEqual(['promo@example.test', 'static@example.test'])
    expect(createRunSheetSend).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventId: EVENT,
          sentById: tui.personId,
        }),
      }),
    )
  })

  it('reads in row order in what gets sent', async () => {
    await sendRunSheet(EVENT, [])

    const [, mail] = sendMail.mock.calls[0]!
    expect(mail.text.indexOf('Pack-in')).toBeLessThan(mail.text.indexOf('Doors'))
  })

  it('records a send and writes an activity line', async () => {
    await sendRunSheet(EVENT, ['pay_act'])

    expect(record).toHaveBeenCalledWith(EVENT, tui, expect.stringContaining('run sheet'))
  })

  it('refuses when this event has no promoter payee to send to', async () => {
    eventRecipients.mockResolvedValue([RECIPIENTS[0]!])

    const out = await sendRunSheet(EVENT, ['pay_act'])

    expect(out.kind).toBe('stop')
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('refuses a ticked act with no email on file, naming them', async () => {
    eventRecipients.mockResolvedValue([{ ...RECIPIENTS[0]!, email: null }, RECIPIENTS[1]!])

    const out = await sendRunSheet(EVENT, ['pay_act'])

    expect(out.kind).toBe('stop')
    expect(out.text).toContain('Static Bloom')
    expect(sendMail).not.toHaveBeenCalled()
  })
})
