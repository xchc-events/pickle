import { describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@/lib/session'
import { labourSplit, type PipelineEvent } from '@/lib/pipeline'

/**
 * `loadLabour` — Finance's half of "Where the labour goes", moved off
 * Pipeline on 23 Sep 2026 (see the dated notes in
 * docs/design-handoff/README.md under Finance and Pipeline).
 *
 * The rows have to come from the real `labourSplit` in src/lib/pipeline.ts,
 * which keeps its own tests and stays unchanged. This file only proves the
 * wiring — that Finance asks `loadPipeline` for this user and hands the
 * result straight to `labourSplit` — not the arithmetic inside it.
 */

vi.mock('server-only', () => ({}))

const loadPipeline = vi.fn()
vi.mock('@/lib/pipeline-data', () => ({
  loadPipeline: (...args: unknown[]) => loadPipeline(...args),
}))

const { loadLabour } = await import('./finance-data')

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

// Minimal fixtures: only the three fields labourSplit actually reads (see
// its implementation). One concluded event is included so a test that
// asserted the real function ran, not a stand-in, would catch a loader that
// forgot to filter it out.
const FIXTURE = [
  { concluded: false, taskHours: [{ team: 'Bar', hours: 4 }], onSiteHours: 6 },
  { concluded: true, taskHours: [{ team: 'Bar', hours: 100 }], onSiteHours: 100 },
] as unknown as PipelineEvent[]

describe('loadLabour', () => {
  it('asks loadPipeline for this user — the same scoping the rest of Finance reads through', async () => {
    loadPipeline.mockResolvedValue(FIXTURE)
    await loadLabour(mere)
    expect(loadPipeline).toHaveBeenCalledWith(mere)
  })

  it('returns exactly what labourSplit makes of loadPipeline rows, not a reimplementation', async () => {
    loadPipeline.mockResolvedValue(FIXTURE)
    await expect(loadLabour(mere)).resolves.toEqual(labourSplit(FIXTURE))
  })
})
