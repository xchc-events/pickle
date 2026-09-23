import { describe, expect, it } from 'vitest'
import {
  actFileRows,
  actFileTally,
  promoterFileRow,
  unassignedFiles,
  type LiveArtist,
} from './tech'
import type { FileRow } from './files-data'

/**
 * Connor, 23 Sep 2026: "The only details we want to see here are tech riders
 * and stage plots. These two want to be per artist, and you can have a
 * section for the promoter as well."
 */

const file = (over: Partial<FileRow> = {}): FileRow => ({
  id: 'file_1',
  name: 'rider.pdf',
  kind: 'RIDER_TECH',
  mime: 'application/pdf',
  size: 1024,
  version: 1,
  at: new Date('2026-09-01'),
  uploadedBy: null,
  artistId: null,
  payeeId: null,
  ...over,
})

const acts: LiveArtist[] = [
  { id: 'art_1', name: 'Static Bloom' },
  { id: 'art_2', name: 'Slow Fold' },
]

describe('per-act file rows', () => {
  it('gives each act only its own rider and stage plot', () => {
    const files = [
      file({ id: 'f1', kind: 'RIDER_TECH', artistId: 'art_1' }),
      file({ id: 'f2', kind: 'STAGE_PLOT', artistId: 'art_2' }),
    ]
    const rows = actFileRows(acts, files)
    expect(rows[0]).toMatchObject({ id: 'art_1', rider: { id: 'f1' }, stagePlot: null })
    expect(rows[1]).toMatchObject({ id: 'art_2', rider: null, stagePlot: { id: 'f2' } })
  })

  it('does not let one act’s rider satisfy another’s row', () => {
    const files = [file({ id: 'f1', kind: 'RIDER_TECH', artistId: 'art_1' })]
    const rows = actFileRows(acts, files)
    expect(rows[1].rider).toBeNull()
  })

  it('ignores a file of some other kind entirely', () => {
    const files = [file({ id: 'f1', kind: 'PRESS_SHOT', artistId: 'art_1' })]
    expect(actFileRows(acts, files)[0]).toMatchObject({ rider: null, stagePlot: null })
  })

  it('is empty for an event with no live acts', () => {
    expect(actFileRows([], [file({ artistId: 'art_1' })])).toEqual([])
  })
})

describe('the promoter’s own row', () => {
  it('is null when the event has no promoter payee', () => {
    expect(promoterFileRow(null, 'Some Promotions', [file({ payeeId: 'pay_1' })])).toBeNull()
  })

  it('reads off the payee, not an act slot', () => {
    const files = [file({ id: 'f1', kind: 'RIDER_TECH', payeeId: 'pay_1', artistId: null })]
    const row = promoterFileRow('pay_1', 'Some Promotions', files)
    expect(row).toMatchObject({ id: 'pay_1', name: 'Some Promotions', rider: { id: 'f1' } })
  })

  it('does not pick up an act’s file even if the payee ids happen to line up', () => {
    // A file attached to an act's slot is never the promoter's row, however
    // its payeeId reads — artistId is what decides it.
    const files = [file({ id: 'f1', kind: 'RIDER_TECH', payeeId: 'pay_1', artistId: 'art_1' })]
    expect(promoterFileRow('pay_1', 'Some Promotions', files)!.rider).toBeNull()
  })
})

describe('unassigned files', () => {
  it('holds a rider or plot with no act and no promoter claim', () => {
    const files = [file({ id: 'f1', kind: 'RIDER_TECH', artistId: null, payeeId: null })]
    expect(unassignedFiles(files, null).map((f) => f.id)).toEqual(['f1'])
  })

  it('excludes a file already on an act', () => {
    const files = [file({ id: 'f1', kind: 'RIDER_TECH', artistId: 'art_1' })]
    expect(unassignedFiles(files, null)).toEqual([])
  })

  it('excludes the promoter’s own row once there is one', () => {
    const files = [file({ id: 'f1', kind: 'RIDER_TECH', artistId: null, payeeId: 'pay_1' })]
    expect(unassignedFiles(files, 'pay_1')).toEqual([])
  })

  it('still shows a payee-linked file when that payee is not this event’s promoter', () => {
    const files = [file({ id: 'f1', kind: 'RIDER_TECH', artistId: null, payeeId: 'pay_other' })]
    expect(unassignedFiles(files, 'pay_1').map((f) => f.id)).toEqual(['f1'])
  })

  it('leaves out kinds Tech does not track per act', () => {
    const files = [file({ id: 'f1', kind: 'TECH_SPEC', artistId: null })]
    expect(unassignedFiles(files, null)).toEqual([])
  })
})

describe('the queue’s have/need', () => {
  it('needs two slots per live act', () => {
    expect(actFileTally(3, [])).toMatchObject({ have: 0, need: 6 })
  })

  it('counts a filled slot once, however many rows claim it', () => {
    const present = [
      { artistId: 'art_1', kind: 'RIDER_TECH' },
      { artistId: 'art_1', kind: 'RIDER_TECH' },
    ]
    expect(actFileTally(1, present).have).toBe(1)
  })

  it('reads good once every slot is filled, stop when nothing is in yet', () => {
    const full = actFileTally(1, [
      { artistId: 'art_1', kind: 'RIDER_TECH' },
      { artistId: 'art_1', kind: 'STAGE_PLOT' },
    ])
    expect([full.tone, full.note]).toEqual(['good', 'everything in'])

    const empty = actFileTally(1, [])
    expect([empty.tone, empty.note]).toEqual(['stop', 'nothing in yet'])
  })

  it('says how many are still to come partway through', () => {
    const half = actFileTally(2, [{ artistId: 'art_1', kind: 'RIDER_TECH' }])
    expect([half.tone, half.note]).toEqual(['warn', '3 still to come'])
  })

  it('reads good with its own note when there are no acts to chase', () => {
    expect(actFileTally(0, [])).toMatchObject({ tone: 'good', note: 'no acts yet' })
  })

  it('does not let a stale slot push have past need', () => {
    // present names an act that is no longer live — liveActCount dropped to 1
    // but the query still returned both.
    const present = [
      { artistId: 'art_1', kind: 'RIDER_TECH' },
      { artistId: 'art_1', kind: 'STAGE_PLOT' },
      { artistId: 'art_2', kind: 'RIDER_TECH' },
    ]
    const tally = actFileTally(1, present)
    expect(tally.have).toBeLessThanOrEqual(tally.need)
  })
})
