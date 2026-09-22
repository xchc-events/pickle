import { beforeEach, describe, expect, it, vi } from 'vitest'
import { affectedLine, NO_LONGER_STANDING, type AffectedHold, type HoldChange } from '@/lib/holds'
import type { SessionUser } from '@/lib/session'

/**
 * The hold actions, and the activity lines they write.
 *
 * Confirming, releasing and challenging change other events' holds as well as
 * the acting event's own: a confirmation releases everyone else on the night,
 * a release moves everyone behind it up, and a challenge puts the 1st hold on
 * notice. Each action used to write one line, on the event it was called from,
 * so the events whose holds had moved had nothing on their feed saying so, or
 * saying who did it.
 *
 * The writers are stood in for here. What they change, and that they report
 * exactly that, is tested against a ladder in holds-data.test.ts; the wording
 * is tested in holds.test.ts. This is about the action writing a line on every
 * event in the report, as the person who acted. Callers from outside the venue
 * are refused before any of it — see actions.test.ts.
 */

// actions.ts now imports @/lib/grants-data (for issueArtistLink, moved here
// from Tech 23 Sep 2026), which imports 'server-only'. The real package
// throws outside a server-component build, so every test file that imports
// actions.ts for real needs this — see artist-link-actions.test.ts.
vi.mock('server-only', () => ({}))

const requireModule = vi.fn()
const requireEvent = vi.fn()
const record = vi.fn()
const confirmHold = vi.fn()
const releaseHold = vi.fn()
const challengeHold = vi.fn()

vi.mock('@/lib/permissions', () => ({
  requireModule: (...args: unknown[]) => requireModule(...args),
  requireEvent: (...args: unknown[]) => requireEvent(...args),
}))
vi.mock('@/lib/activity', () => ({ record: (...args: unknown[]) => record(...args) }))
vi.mock('@/lib/holds-data', () => ({
  confirmHold: (...args: unknown[]) => confirmHold(...args),
  releaseHold: (...args: unknown[]) => releaseHold(...args),
  challengeHold: (...args: unknown[]) => challengeHold(...args),
}))
vi.mock('next/cache', () => ({ refresh: () => {} }))
// None of these actions reads the database or the event record directly. If
// one starts to, these fail it rather than letting it pass against nothing.
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/event-record-data', () => ({
  loadEventRecord: () => {
    throw new Error('reached loadEventRecord')
  },
}))

const actions = await import('./actions')

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

/**
 * Saturday in Main: Slow Fold holds it first, Static Bloom and Dust to
 * Mountains are queued behind.
 */
const SLOW_FOLD = 'evt_slow_fold'
const STATIC_BLOOM = 'evt_static_bloom'
const DUST = 'evt_dust_to_mountains'

const affected = (
  holdId: string,
  eventId: string,
  change: HoldChange,
  rank: number,
): AffectedHold => ({
  holdId,
  eventId,
  change,
  rank,
  spaceName: 'Main',
  date: new Date(2026, 9, 3),
})

beforeEach(() => {
  vi.clearAllMocks()
  requireModule.mockResolvedValue({ user: mere, modules: ['pipeline'] })
  requireEvent.mockImplementation(async (_user: SessionUser, eventId: string) => eventId)
})

describe.each([
  {
    action: 'takeTheNight' as const,
    writer: confirmHold,
    from: SLOW_FOLD,
    hold: 'hold_sf',
    ownLine: 'confirmed the room — every other hold on that night was released',
    report: [
      affected('hold_sb', STATIC_BLOOM, 'released', 2),
      affected('hold_dtm', DUST, 'released', 3),
    ],
  },
  {
    action: 'dropTheHold' as const,
    writer: releaseHold,
    from: SLOW_FOLD,
    hold: 'hold_sf',
    ownLine: 'released a hold — anyone behind it moved up',
    report: [
      affected('hold_sb', STATIC_BLOOM, 'moved_up', 1),
      affected('hold_dtm', DUST, 'moved_up', 2),
    ],
  },
  {
    action: 'challengeTheHold' as const,
    writer: challengeHold,
    from: STATIC_BLOOM,
    hold: 'hold_sb',
    ownLine: 'challenged the hold above this one',
    report: [affected('hold_sf', SLOW_FOLD, 'challenged', 1)],
  },
])('$action', ({ action, writer, from, hold, ownLine, report }) => {
  it('writes its own line on the event it was called from, then a line on every event whose hold the write changed, as the person who acted', async () => {
    writer.mockResolvedValue({ ok: true, affected: report })

    await actions[action](from, hold)

    expect(writer).toHaveBeenCalledWith(hold, from)
    expect(record.mock.calls).toEqual([
      [from, mere, ownLine],
      ...report.map((h) => [h.eventId, mere, affectedLine(h)]),
    ])
  })

  it('writes only its own line when the write changed no other hold', async () => {
    writer.mockResolvedValue({ ok: true, affected: [] })

    await actions[action](from, hold)

    expect(record.mock.calls).toEqual([[from, mere, ownLine]])
  })

  it('writes nothing when the write is refused', async () => {
    writer.mockResolvedValue({ ok: false, why: NO_LONGER_STANDING })

    await expect(actions[action](from, hold)).resolves.toEqual({
      kind: 'warn',
      text: NO_LONGER_STANDING,
    })
    expect(record).not.toHaveBeenCalled()
  })
})
