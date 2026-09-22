import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canChangeEventRecord } from '@/lib/event-record'
import { dateLabel } from '@/lib/format'
import { nightInput, nightOf } from '@/lib/night'
import type { SessionUser } from '@/lib/session'

/**
 * `setRunTime` and `setEndDate`: the free times, and the night an event ends.
 *
 * `runProblems` and `endNightFor` are tested as rules in run-times.test.ts.
 * This is about the two actions built on them — that each converts, re-reads
 * the record, infers or keeps the end date correctly, refuses on the first
 * problem with nothing written, and only ever writes once it has passed every
 * check. Kept apart from actions.test.ts, which proves every export is gated
 * the same way but stops before any of them reach real logic.
 */

// actions.ts now imports @/lib/grants-data (for issueArtistLink, moved here
// from Tech 23 Sep 2026), which imports 'server-only'. The real package
// throws outside a server-component build, so every test file that imports
// actions.ts for real needs this — see artist-link-actions.test.ts.
vi.mock('server-only', () => ({}))

const requireModule = vi.fn()
const requireEvent = vi.fn()

vi.mock('@/lib/permissions', () => ({
  requireModule: (...args: unknown[]) => requireModule(...args),
  requireEvent: (...args: unknown[]) => requireEvent(...args),
}))

/** What the event record currently holds. Reset before each test. */
let row: {
  date: Date
  doors: string | null
  barClose: string | null
  allOut: string | null
  endDate: Date | null
}

const findUniqueOrThrow = vi.fn(async () => row)
const update = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    event: {
      findUniqueOrThrow,
      update: (...args: unknown[]) => update(...args),
    },
  },
}))

const record = vi.fn()
const refresh = vi.fn()

vi.mock('@/lib/activity', () => ({ record: (...args: unknown[]) => record(...args) }))
vi.mock('next/cache', () => ({ refresh: (...args: unknown[]) => refresh(...args) }))

// Server-only neighbours of setRunTime/setEndDate in actions.ts. Neither
// function reaches them.
vi.mock('@/lib/event-record-data', () => ({ loadEventRecord: vi.fn() }))
vi.mock('@/lib/holds-data', () => ({
  placeHold: vi.fn(),
  confirmHold: vi.fn(),
  releaseHold: vi.fn(),
  challengeHold: vi.fn(),
}))

const { setRunTime, setEndDate } = await import('./actions')

/** Slow Fold, which Kōura Records brought — same fixture as set-owner.test.ts. */
const EVENT = 'evt_slow_fold'

const NIGHT = nightOf(2026, 8, 19)
const NEXT_NIGHT = nightOf(2026, 8, 20)
const CHOSEN_NIGHT = nightOf(2026, 8, 21)

const coordinator = {
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

const refusal = canChangeEventRecord(awhina)
const REFUSED = { kind: 'stop', text: refusal.ok ? '' : refusal.why }
const NOT_FOUND = new Error('NEXT_HTTP_ERROR_FALLBACK;404')

beforeEach(() => {
  vi.clearAllMocks()
  requireModule.mockResolvedValue({ user: coordinator, modules: ['pipeline'] })
  requireEvent.mockResolvedValue(EVENT)
  row = { date: NIGHT, doors: '8:00pm', barClose: '11:30pm', allOut: '11:00pm', endDate: NIGHT }
})

describe('setRunTime', () => {
  it('stores the clock label, not the raw input value', async () => {
    row = { date: NIGHT, doors: '8:00pm', barClose: null, allOut: '11:30pm', endDate: NIGHT }

    await expect(setRunTime(EVENT, 'barClose', '23:15')).resolves.toEqual({
      kind: 'good',
      text: 'Bar close set — the licence gate and every shift read off it.',
    })

    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: EVENT },
      select: { date: true, doors: true, barClose: true, allOut: true, endDate: true },
    })
    expect(update).toHaveBeenCalledWith({ where: { id: EVENT }, data: { barClose: '11:15pm' } })
    expect(record).toHaveBeenCalledWith(EVENT, coordinator, 'set bar close to 11:15pm')
    expect(refresh).toHaveBeenCalled()
  })

  it('clears a field and records it as cleared', async () => {
    await expect(setRunTime(EVENT, 'barClose', '')).resolves.toEqual({
      kind: 'good',
      text: 'Bar close cleared.',
    })

    expect(update).toHaveBeenCalledWith({ where: { id: EVENT }, data: { barClose: null } })
    expect(record).toHaveBeenCalledWith(EVENT, coordinator, 'cleared bar close')
  })

  it('refuses a time it cannot parse and writes nothing', async () => {
    await expect(setRunTime(EVENT, 'doors', 'garbage')).resolves.toEqual({
      kind: 'warn',
      text: 'That is not a time.',
    })

    expect(findUniqueOrThrow).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses a change that fails runProblems and writes nothing', async () => {
    row = { date: NIGHT, doors: '8:00pm', barClose: null, allOut: '11:30pm', endDate: NIGHT }

    // A bar close typed the same as doors — refused at the minute it opens.
    await expect(setRunTime(EVENT, 'barClose', '20:00')).resolves.toEqual({
      kind: 'warn',
      text: 'The bar closes after the doors open and before everyone is out.',
    })

    expect(update).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('carries the end date forward when it was only ever inferred', async () => {
    // Doors 8pm, everyone out 11pm both read as the same night, and endDate
    // was never hand-picked — it is exactly what those times would infer.
    // Pushing everyone-out past midnight should carry the end date with it.
    await expect(setRunTime(EVENT, 'allOut', '00:30')).resolves.toEqual({
      kind: 'good',
      text: 'Everyone out set.',
    })

    expect(update).toHaveBeenCalledWith({
      where: { id: EVENT },
      data: { allOut: '12:30am', endDate: NEXT_NIGHT },
    })
    expect(record).toHaveBeenCalledWith(EVENT, coordinator, 'set everyone out to 12:30am')
  })

  it('leaves a hand-picked end date alone', async () => {
    // Same starting doors/everyone-out as above, but the end date was chosen
    // by hand to a night later than those times alone would ever infer.
    row = { date: NIGHT, doors: '8:00pm', barClose: null, allOut: '11:00pm', endDate: CHOSEN_NIGHT }

    await expect(setRunTime(EVENT, 'allOut', '00:30')).resolves.toEqual({
      kind: 'good',
      text: 'Everyone out set.',
    })

    expect(update).toHaveBeenCalledWith({ where: { id: EVENT }, data: { allOut: '12:30am' } })
  })

  it('refuses an outside promoter before anything is read or written', async () => {
    requireModule.mockResolvedValue({ user: awhina, modules: ['pipeline', 'portal'] })

    await expect(setRunTime(EVENT, 'doors', '20:00')).resolves.toEqual(REFUSED)

    expect(requireEvent).not.toHaveBeenCalled()
    expect(findUniqueOrThrow).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('404s rather than explaining itself, when Pipeline is not open to them', async () => {
    requireModule.mockRejectedValue(NOT_FOUND)

    await expect(setRunTime(EVENT, 'doors', '20:00')).rejects.toBe(NOT_FOUND)

    expect(requireModule).toHaveBeenCalledWith('pipeline')
    expect(requireEvent).not.toHaveBeenCalled()
    expect(findUniqueOrThrow).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})

describe('setEndDate', () => {
  it('sets the night it ends', async () => {
    await expect(setEndDate(EVENT, nightInput(NEXT_NIGHT))).resolves.toEqual({
      kind: 'good',
      text: `Ends ${dateLabel(NEXT_NIGHT)} — the room is taken until then.`,
    })

    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: EVENT },
      select: { date: true, doors: true, barClose: true, allOut: true },
    })
    expect(update).toHaveBeenCalledWith({ where: { id: EVENT }, data: { endDate: NEXT_NIGHT } })
    expect(record).toHaveBeenCalledWith(
      EVENT,
      coordinator,
      `set the night it ends to ${dateLabel(NEXT_NIGHT)}`,
    )
    expect(refresh).toHaveBeenCalled()
  })

  it('clears back to the night the times infer', async () => {
    row = {
      date: NIGHT,
      doors: '8:00pm',
      barClose: '11:30pm',
      allOut: '1:00am',
      endDate: CHOSEN_NIGHT,
    }

    await expect(setEndDate(EVENT, '')).resolves.toEqual({
      kind: 'good',
      text: `Ends ${dateLabel(NEXT_NIGHT)} — the room is taken until then.`,
    })

    expect(update).toHaveBeenCalledWith({ where: { id: EVENT }, data: { endDate: NEXT_NIGHT } })
  })

  it('refuses a date it cannot parse and writes nothing', async () => {
    await expect(setEndDate(EVENT, 'garbage')).resolves.toEqual({
      kind: 'warn',
      text: 'Pick the night it ends.',
    })

    expect(findUniqueOrThrow).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses an end date that fails runProblems and writes nothing', async () => {
    const tooEarly = nightOf(2026, 8, 18)

    await expect(setEndDate(EVENT, nightInput(tooEarly))).resolves.toEqual({
      kind: 'warn',
      text: 'The night cannot end before it starts.',
    })

    expect(update).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('refuses an outside promoter before anything is read or written', async () => {
    requireModule.mockResolvedValue({ user: awhina, modules: ['pipeline', 'portal'] })

    await expect(setEndDate(EVENT, nightInput(NEXT_NIGHT))).resolves.toEqual(REFUSED)

    expect(requireEvent).not.toHaveBeenCalled()
    expect(findUniqueOrThrow).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('404s rather than explaining itself, when Pipeline is not open to them', async () => {
    requireModule.mockRejectedValue(NOT_FOUND)

    await expect(setEndDate(EVENT, nightInput(NEXT_NIGHT))).rejects.toBe(NOT_FOUND)

    expect(requireModule).toHaveBeenCalledWith('pipeline')
    expect(requireEvent).not.toHaveBeenCalled()
    expect(findUniqueOrThrow).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})
