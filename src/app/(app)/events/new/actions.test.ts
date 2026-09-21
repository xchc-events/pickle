import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'
import type { CleanEnquiry } from '@/lib/intake'
import { FIELD, HOUSE_TASKS, startedLine, startedSaid } from '@/lib/intake'
import { nightInput, venueToday } from '@/lib/night'
import { dateLabel } from '@/lib/format'

/**
 * Starting an enquiry, from a `FormData` in to the one `db.event.create` out.
 *
 * Nothing here mocks `@/lib/intake`, `@/lib/night` or `@/lib/intake-data` —
 * the rules and the data layer run for real, so this drives the permission
 * whitelist the way a hostile POST would: fields no form control would ever
 * send, on a request that skipped the browser entirely. set-lead.test.ts is
 * the model for the harness; this file asks more of the database because
 * `startEnquiry` is the only place an `Event` is born outside the seed.
 */

const requireModule = vi.fn()

vi.mock('@/lib/permissions', () => ({
  requireModule: (...args: unknown[]) => requireModule(...args),
}))

// intake-data.ts imports it for real; nothing here needs the genuine module.
vi.mock('server-only', () => ({}))

/** One room, named to match the words the spec and the seed both use. */
const SPACES = [{ id: 'space_main', name: 'Main', capacity: 400, seatedCapacity: 150 }]

/** Jonty is on the books; Kev left, so Admin switched him off. */
const PEOPLE = [
  { id: 'person_mere', name: 'Mere Tapu', active: true },
  { id: 'person_jonty', name: 'Jonty Rewi', active: true },
  { id: 'person_kev', name: 'Kev Loach', active: false },
]

/** Kōura is Awhina's own organisation. Other Promotions belongs to nobody in this file. */
const ORGS = [
  { id: 'org_koura', name: 'Kōura Records' },
  { id: 'org_other', name: 'Other Promotions' },
]

// Bare `vi.fn()`s: some tests read `.mock.calls[...]` directly (deep create
// payloads), which a typed implementation would fight. Realistic behaviour
// is installed once below with `mockImplementation`, which `clearAllMocks`
// in `beforeEach` does not remove — only call history is reset per test.
const spaceFindMany = vi.fn()
const spaceFindFirst = vi.fn()
const personFindMany = vi.fn()
const personFindFirst = vi.fn()
const payeeFindMany = vi.fn()
const payeeFindFirst = vi.fn()
const eventCreate = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    space: {
      findMany: (...args: unknown[]) => spaceFindMany(...args),
      findFirst: (...args: unknown[]) => spaceFindFirst(...args),
    },
    person: {
      findMany: (...args: unknown[]) => personFindMany(...args),
      findFirst: (...args: unknown[]) => personFindFirst(...args),
    },
    payee: {
      findMany: (...args: unknown[]) => payeeFindMany(...args),
      findFirst: (...args: unknown[]) => payeeFindFirst(...args),
    },
    event: {
      create: (...args: unknown[]) => eventCreate(...args),
    },
  },
}))

spaceFindMany.mockImplementation(async () => SPACES)
spaceFindFirst.mockImplementation(
  async ({ where }: { where: { id: string } }) => SPACES.find((s) => s.id === where.id) ?? null,
)
personFindMany.mockImplementation(async () =>
  PEOPLE.filter((p) => p.active).map(({ id, name }) => ({ id, name })),
)
personFindFirst.mockImplementation(
  async ({ where }: { where: { id?: string; active?: boolean } }) =>
    PEOPLE.find((p) => p.id === where.id && p.active === where.active) ?? null,
)
payeeFindMany.mockImplementation(async () => ORGS)
payeeFindFirst.mockImplementation(async ({ where }: { where: { id?: string; kind?: string } }) =>
  where.kind === 'PROMOTER' ? (ORGS.find((o) => o.id === where.id) ?? null) : null,
)
eventCreate.mockImplementation(async () => ({ id: 'evt_new' }))

const placeHold = vi.fn()
vi.mock('@/lib/holds-data', () => ({ placeHold: (...args: unknown[]) => placeHold(...args) }))

const record = vi.fn()
vi.mock('@/lib/activity', () => ({ record: (...args: unknown[]) => record(...args) }))

const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }))

const { startEnquiry } = await import('./actions')
const { createEnquiry, loadIntakeOptions } = await import('@/lib/intake-data')

const mere = {
  id: 'user_mere',
  email: 'mere@xchc.test',
  name: 'Mere Tapu',
  role: 'COORDINATOR',
  roleKey: 'coordinator',
  organisationId: null,
  organisationName: null,
  external: false,
  personId: 'person_mere',
  initials: 'MT',
  authenticated: true,
  sessionId: 'session_mere',
} satisfies SessionUser

const awhina = {
  id: 'user_awhina',
  email: 'awhina@koura.test',
  name: 'Awhina Reid',
  role: 'PROMOTER',
  roleKey: 'promoter',
  organisationId: 'org_koura',
  organisationName: 'Kōura Records',
  external: true,
  personId: null,
  initials: 'AR',
  authenticated: true,
  sessionId: 'session_awhina',
} satisfies SessionUser

/** A night safely ahead of the real clock, as both the form sends it and the rules store it. */
const FUTURE = new Date(venueToday().getTime() + 30 * 86_400_000)
const FUTURE_INPUT = nightInput(FUTURE)

type FormFields = Record<string, string | boolean>
interface ActRow {
  name?: string
  status?: string
  low?: string
  high?: string
}

/** A real FormData, keyed the way EnquiryForm sends one. */
function enquiryForm(fields: FormFields, acts: ActRow[] = []): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'boolean') {
      if (value) form.set(key, 'on')
    } else {
      form.set(key, value)
    }
  }
  for (const act of acts) {
    form.append(FIELD.actName, act.name ?? '')
    form.append(FIELD.actStatus, act.status ?? '')
    form.append(FIELD.actLow, act.low ?? '')
    form.append(FIELD.actHigh, act.high ?? '')
  }
  return form
}

const validStaffFields = (): FormFields => ({
  [FIELD.name]: 'Winter Social',
  [FIELD.date]: FUTURE_INPUT,
  [FIELD.spaceId]: 'space_main',
  [FIELD.kind]: 'djs',
  [FIELD.format]: 'DJs',
  [FIELD.doors]: '',
  [FIELD.barClose]: '',
  [FIELD.allOut]: '',
  [FIELD.endDate]: '',
  [FIELD.ownerId]: 'person_mere',
  [FIELD.model]: 'curator',
  [FIELD.std]: '25',
  [FIELD.door]: '30',
  [FIELD.mixSub]: '20',
  [FIELD.mixStd]: '40',
  [FIELD.mixSup]: '15',
  [FIELD.mixDoor]: '25',
  [FIELD.bringing]: 'venue',
  [FIELD.organisationId]: '',
  [FIELD.promoterName]: '',
  [FIELD.split]: '50',
  [FIELD.attQuiet]: '40',
  [FIELD.attLikely]: '80',
  [FIELD.attGreat]: '120',
  [FIELD.barHead]: '25',
  [FIELD.gear]: '250',
  [FIELD.adv]: '150',
  [FIELD.sound]: 'inhouse',
  [FIELD.crew]: '6',
  [FIELD.tok]: '2',
  [FIELD.brief]: '',
})

function staffForm(overrides: FormFields = {}, acts: ActRow[] = []): FormData {
  return enquiryForm({ ...validStaffFields(), ...overrides }, acts)
}

const validOutsideFields = (): FormFields => ({
  [FIELD.name]: 'Kōura winter session',
  [FIELD.date]: FUTURE_INPUT,
  [FIELD.spaceId]: 'space_main',
  [FIELD.kind]: 'djs',
  [FIELD.format]: 'DJs',
  [FIELD.doors]: '',
  [FIELD.barClose]: '',
  [FIELD.allOut]: '',
  [FIELD.endDate]: '',
  [FIELD.note]: '',
})

function outsideForm(overrides: FormFields = {}, acts: ActRow[] = []): FormData {
  return enquiryForm({ ...validOutsideFields(), ...overrides }, acts)
}

/** Every way this suite can read or write, asserted silent together. */
function expectNothingHappened() {
  expect(spaceFindMany).not.toHaveBeenCalled()
  expect(spaceFindFirst).not.toHaveBeenCalled()
  expect(personFindMany).not.toHaveBeenCalled()
  expect(personFindFirst).not.toHaveBeenCalled()
  expect(payeeFindMany).not.toHaveBeenCalled()
  expect(payeeFindFirst).not.toHaveBeenCalled()
  expect(eventCreate).not.toHaveBeenCalled()
  expect(placeHold).not.toHaveBeenCalled()
  expect(record).not.toHaveBeenCalled()
  expect(revalidatePath).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  requireModule.mockResolvedValue({ user: mere })
})

describe('who may start one', () => {
  const NOT_FOUND = new Error('NEXT_HTTP_ERROR_FALLBACK;404')

  it('gives a role without Pipeline the 404, and reads or writes nothing', async () => {
    requireModule.mockRejectedValue(NOT_FOUND)

    await expect(startEnquiry(new FormData())).rejects.toBe(NOT_FOUND)

    expect(requireModule).toHaveBeenCalledWith('pipeline')
    expectNothingHappened()
  })

  it('refuses an outside account with no organisation, in words, before anything is read or written', async () => {
    const orphan = { ...awhina, organisationId: null } satisfies SessionUser
    requireModule.mockResolvedValue({ user: orphan })

    const result = await startEnquiry(new FormData())

    expect(result).toEqual({
      said: {
        kind: 'stop',
        text: 'This account is not attached to a promoter organisation yet, so an enquiry would have nowhere to belong. Your coordinator at the venue can set that up.',
      },
      eventId: null,
      errors: {},
    })
    expectNothingHappened()
  })
})

describe('the hostile POST', () => {
  it('keeps an outside account to its own organisation and its own split, but writes the figures it proposed', async () => {
    requireModule.mockResolvedValue({ user: awhina })
    const form = outsideForm(
      {
        [FIELD.ownerId]: 'person_mere',
        [FIELD.model]: 'dry',
        [FIELD.bringing]: 'organisation',
        [FIELD.organisationId]: 'org_other',
        [FIELD.split]: '100',
        [FIELD.endDate]: FUTURE_INPUT,
        [FIELD.std]: '35',
        [FIELD.door]: '40',
        [FIELD.mixSub]: '20',
        [FIELD.mixStd]: '40',
        [FIELD.mixSup]: '15',
        [FIELD.mixDoor]: '25',
        [FIELD.attQuiet]: '100',
        [FIELD.attLikely]: '200',
        [FIELD.attGreat]: '300',
        [FIELD.barHead]: '30',
        [FIELD.gear]: '500',
        [FIELD.adv]: '300',
        [FIELD.sound]: 'wheke',
        [FIELD.crew]: '8',
        [FIELD.tok]: '3',
        [FIELD.brief]: 'Give us the full split',
        [FIELD.hold]: true,
      },
      [{ name: 'House DJ', status: 'confirmed', low: '5000', high: '9000' }],
    )

    const result = await startEnquiry(form)

    expect(eventCreate).toHaveBeenCalledTimes(1)
    const data = eventCreate.mock.calls[0][0].data
    expect(data).toMatchObject({
      promoterId: 'org_koura',
      promoter: 'Kōura Records',
      internal: false,
      ownerId: null,
      // Their proposal: the model, the prices, the mix, who they expect,
      // what it costs them — none of this is theirs to hide from a
      // coordinator correcting it afterwards.
      model: 'DRY',
      dateTbc: true,
      split: 0.6,
      endDate: FUTURE,
      std: 35,
      door: 40,
      mix: [0.2, 0.4, 0.15, 0.25],
      att: [100, 200, 300],
      barHead: 30,
      gear: 500,
      adv: 300,
      sound: 'wheke',
      crew: 8,
      tok: 3,
      brief: null,
    })
    expect(data.artists.create).toEqual([
      { name: 'House DJ', status: 'ENQUIRED', low: 5000, high: 9000, order: 0 },
    ])
    expect(placeHold).not.toHaveBeenCalled()
    expect(payeeFindFirst).toHaveBeenCalledTimes(1)
    expect(payeeFindFirst).toHaveBeenCalledWith({
      where: { id: 'org_koura', kind: 'PROMOTER' },
      select: { name: true },
    })
    expect(result.eventId).toBe('evt_new')
  })
})

describe('createEnquiry called directly, as a forged CleanEnquiry could reach it', () => {
  it("still writes the caller's own organisation and a null owner, whatever the value claims", async () => {
    const forged: CleanEnquiry = {
      name: 'Forged night',
      date: FUTURE,
      dateTbc: false,
      spaceId: 'space_main',
      kind: 'djs',
      format: 'DJs',
      doors: null,
      barClose: null,
      allOut: null,
      endDate: null,
      model: 'curator',
      std: 0,
      door: 0,
      mix: [0.2, 0.4, 0.15, 0.25],
      acts: [],
      note: null,
      alternates: [],
      ownerId: 'person_mere',
      bringing: { by: 'organisation', organisationId: 'org_other' },
      split: 0,
      att: [0, 0, 0],
      barHead: 0,
      gear: 0,
      adv: 0,
      sound: 'inhouse',
      crew: 0,
      tok: 0,
      brief: null,
      hold: false,
    }

    const result = await createEnquiry(awhina, forged)

    expect(result).toEqual({ ok: true, eventId: 'evt_new', spaceName: 'Main' })
    expect(eventCreate).toHaveBeenCalledTimes(1)
    expect(eventCreate.mock.calls[0][0].data).toMatchObject({
      promoterId: 'org_koura',
      promoter: 'Kōura Records',
      ownerId: null,
      internal: false,
    })
    expect(payeeFindFirst).toHaveBeenCalledWith({
      where: { id: 'org_koura', kind: 'PROMOTER' },
      select: { name: true },
    })
    expect(personFindFirst).not.toHaveBeenCalled()
  })
})

describe('loadIntakeOptions', () => {
  it('hands an outside account the rooms only, and never even queries people or organisations', async () => {
    const options = await loadIntakeOptions(awhina)

    expect(options).toEqual({ spaces: SPACES, people: [], organisations: [] })
    expect(personFindMany).not.toHaveBeenCalled()
    expect(payeeFindMany).not.toHaveBeenCalled()
  })

  it('hands a coordinator active people and PROMOTER organisations, both by name', async () => {
    const options = await loadIntakeOptions(mere)

    expect(options).toEqual({
      spaces: SPACES,
      people: [
        { id: 'person_mere', name: 'Mere Tapu' },
        { id: 'person_jonty', name: 'Jonty Rewi' },
      ],
      organisations: ORGS,
    })
    expect(personFindMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })
    expect(payeeFindMany).toHaveBeenCalledWith({
      where: { kind: 'PROMOTER' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    })
  })
})

describe('staff happy path', () => {
  it('creates the acts in order, the house tasks, and the one activity line', async () => {
    // Two alternates, so the same submit checks they reach the activity line.
    const alt1 = new Date(FUTURE.getTime() + 7 * 86_400_000)
    const alt2 = new Date(FUTURE.getTime() + 14 * 86_400_000)
    const form = staffForm(
      {
        [FIELD.note]: 'Keep it chill',
        [FIELD.alt1]: nightInput(alt1),
        [FIELD.alt2]: nightInput(alt2),
      },
      [
        { name: 'Sculled', status: 'pencilled', low: '500', high: '900' },
        { name: 'Wet Lettuce', status: 'confirmed', low: '200', high: '400' },
      ],
    )

    const result = await startEnquiry(form)

    expect(eventCreate).toHaveBeenCalledTimes(1)
    const call = eventCreate.mock.calls[0][0]
    expect(call.data).toMatchObject({
      name: 'Winter Social',
      spaceId: 'space_main',
      ownerId: 'person_mere',
      promoterId: null,
      promoter: 'internal · Mere Tapu',
      internal: true,
      model: 'CURATOR',
      dateTbc: false,
      split: 0.5,
      // Blank doors/allOut mean nothing to auto-fill an end night from.
      endDate: null,
      std: 25,
      door: 30,
      mix: [0.2, 0.4, 0.15, 0.25],
      att: [40, 80, 120],
      barHead: 25,
      gear: 250,
      adv: 150,
      crew: 6,
      tok: 2,
      brief: null,
    })
    expect(call.data.date).toEqual(FUTURE)
    expect(call.data.artists.create).toEqual([
      { name: 'Sculled', status: 'PENCILLED', low: 500, high: 900, order: 0 },
      { name: 'Wet Lettuce', status: 'CONFIRMED', low: 200, high: 400, order: 1 },
    ])
    expect(call.data.tasks.create).toEqual(HOUSE_TASKS.map((t) => ({ name: t.name, est: t.est })))
    expect(call.data.activity.create).toEqual([
      {
        personId: 'person_mere',
        who: 'MT',
        text: startedLine({
          external: false,
          organisationName: null,
          spaceName: 'Main',
          date: FUTURE,
          dateTbc: false,
          note: 'Keep it chill',
          alternates: [alt1, alt2],
        }),
      },
    ])
    expect(call.select).toEqual({ id: true })
    expect(result.eventId).toBe('evt_new')
  })

  it('maps dry hire to the schema value', async () => {
    const form = staffForm({ [FIELD.model]: 'dry' })

    await startEnquiry(form)

    expect(eventCreate.mock.calls[0][0].data.model).toBe('DRY')
  })
})

describe('who is bringing it', () => {
  it("venue, with an owner: internal, no promoter row, the DATABASE name — not the caller's own", async () => {
    const form = staffForm({ [FIELD.bringing]: 'venue', [FIELD.ownerId]: 'person_jonty' })

    await startEnquiry(form)

    expect(eventCreate.mock.calls[0][0].data).toMatchObject({
      internal: true,
      promoterId: null,
      promoter: 'internal · Jonty Rewi',
      ownerId: 'person_jonty',
    })
  })

  it('venue, with nobody yet: internal and unassigned', async () => {
    const form = staffForm({ [FIELD.bringing]: 'venue', [FIELD.ownerId]: '' })

    await startEnquiry(form)

    expect(eventCreate.mock.calls[0][0].data).toMatchObject({
      internal: true,
      promoterId: null,
      promoter: 'internal · unassigned',
      ownerId: null,
    })
  })

  it('an organisation on file: its id and its name', async () => {
    const form = staffForm({
      [FIELD.bringing]: 'organisation',
      [FIELD.organisationId]: 'org_koura',
      [FIELD.ownerId]: '',
    })

    await startEnquiry(form)

    expect(eventCreate.mock.calls[0][0].data).toMatchObject({
      internal: false,
      promoterId: 'org_koura',
      promoter: 'Kōura Records',
    })
  })

  it('a name not on file: the typed name, no promoter row', async () => {
    const form = staffForm({
      [FIELD.bringing]: 'name',
      [FIELD.promoterName]: 'The Loose Ends Collective',
      [FIELD.ownerId]: '',
    })

    await startEnquiry(form)

    expect(eventCreate.mock.calls[0][0].data).toMatchObject({
      internal: false,
      promoterId: null,
      promoter: 'The Loose Ends Collective',
    })
  })
})

describe('refusals that write nothing', () => {
  it('refuses a room that is not on the books, even after it passed cleaning', async () => {
    // Simulates the room vanishing between the list cleanEnquiry validated
    // against and the create — createEnquiry re-checks rather than trusting it.
    spaceFindFirst.mockResolvedValueOnce(null)

    const result = await startEnquiry(staffForm())

    expect(result).toEqual({
      said: { kind: 'warn', text: 'That room is not on the books.' },
      eventId: null,
      errors: { spaceId: 'That room is not on the books.' },
    })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('refuses an owner not on the books, filtered to active people', async () => {
    const form = staffForm({ [FIELD.ownerId]: 'person_kev' })

    const result = await startEnquiry(form)

    expect(result).toEqual({
      said: { kind: 'warn', text: 'That person is not on the books.' },
      eventId: null,
      errors: { ownerId: 'That person is not on the books.' },
    })
    expect(personFindFirst).toHaveBeenCalledWith({
      where: { id: 'person_kev', active: true },
      select: { id: true, name: true },
    })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('refuses an organisation not on file, filtered to PROMOTER payees', async () => {
    const form = staffForm({
      [FIELD.bringing]: 'organisation',
      [FIELD.organisationId]: 'org_ghost',
      [FIELD.ownerId]: '',
    })

    const result = await startEnquiry(form)

    expect(result).toEqual({
      said: { kind: 'warn', text: 'That organisation is not on file.' },
      eventId: null,
      errors: { organisationId: 'That organisation is not on file.' },
    })
    expect(payeeFindFirst).toHaveBeenCalledWith({
      where: { id: 'org_ghost', kind: 'PROMOTER' },
      select: { name: true },
    })
    expect(eventCreate).not.toHaveBeenCalled()
  })

  it('returns the first validation error as the toast, and the whole errors map', async () => {
    const form = staffForm({ [FIELD.name]: 'A' })

    const result = await startEnquiry(form)

    expect(result).toEqual({
      said: { kind: 'warn', text: 'Give the event a name — it is what every screen calls it.' },
      eventId: null,
      errors: { name: 'Give the event a name — it is what every screen calls it.' },
    })
    expect(eventCreate).not.toHaveBeenCalled()
  })
})

describe('the hold', () => {
  it('places it and records the line when requested and granted', async () => {
    placeHold.mockResolvedValue({ ok: true })
    const form = staffForm({ [FIELD.hold]: true })

    const result = await startEnquiry(form)

    expect(placeHold).toHaveBeenCalledWith('evt_new', 'space_main', FUTURE)
    expect(record).toHaveBeenCalledWith(
      'evt_new',
      mere,
      `placed a hold on Main for ${dateLabel(FUTURE)}`,
    )
    expect(result.eventId).toBe('evt_new')
  })

  it('keeps the event but warns when the hold is refused, without an activity line', async () => {
    placeHold.mockResolvedValue({ ok: false, why: 'Somebody already holds Main that night.' })
    const form = staffForm({ [FIELD.hold]: true })

    const result = await startEnquiry(form)

    expect(result.eventId).toBe('evt_new')
    expect(result.said).toEqual({
      kind: 'warn',
      text: 'Enquiry started, but the room was not held — Somebody already holds Main that night.',
    })
    expect(record).not.toHaveBeenCalled()
  })

  it('is never called when a hold was not requested', async () => {
    const form = staffForm({ [FIELD.hold]: false })

    await startEnquiry(form)

    expect(placeHold).not.toHaveBeenCalled()
  })
})

describe('success', () => {
  it('revalidates the pipeline and says what a staff enquiry is waiting on', async () => {
    const form = staffForm({ [FIELD.ownerId]: '' })

    const result = await startEnquiry(form)

    expect(revalidatePath).toHaveBeenCalledWith('/pipeline')
    expect(result).toEqual({
      said: startedSaid({ external: false, hasOwner: false, dateTbc: false }),
      eventId: 'evt_new',
      errors: {},
    })
  })

  it('says what happens next for an outside account', async () => {
    requireModule.mockResolvedValue({ user: awhina })
    const form = outsideForm()

    const result = await startEnquiry(form)

    expect(result).toEqual({
      said: startedSaid({ external: true, hasOwner: false, dateTbc: true }),
      eventId: 'evt_new',
      errors: {},
    })
  })
})

describe('the module surface', () => {
  it('exports startEnquiry and nothing else', async () => {
    const mod = await import('./actions')

    expect(Object.keys(mod)).toEqual(['startEnquiry'])
  })
})
