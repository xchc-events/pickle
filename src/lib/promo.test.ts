import { describe, expect, it } from 'vitest'
import {
  BEATS,
  GATED_BEATS,
  PLATFORMS,
  PRE_POST_RULES,
  beatRows,
  beatsWorkedLine,
  channelCards,
  channelSummary,
  promoQueueRow,
  type EventChannel,
} from './promo'

const push = (channel: string, over: Partial<EventChannel> = {}): EventChannel => ({
  channel,
  live: true,
  stale: false,
  note: null,
  byName: null,
  when: null,
  ...over,
})

/** Every channel out and matching the record. */
const allOut = (): EventChannel[] => PLATFORMS.map((p) => push(p.key))

describe('the channel set', () => {
  it('is ten channels off one record', () => {
    expect(PLATFORMS).toHaveLength(10)
  })

  it('holds two that no API will post for us', () => {
    expect(PLATFORMS.filter((p) => p.kind === 'manual').map((p) => p.key)).toEqual([
      'instagram',
      'eventshub',
    ])
  })

  // A post or a send was true when it went out; Gather is the record's own
  // front end. Only standing listings can contradict the record.
  it('exempts one-off posts and the source of truth from going stale', () => {
    expect(PLATFORMS.filter((p) => !p.mirrors).map((p) => p.key)).toEqual([
      'gather',
      'instagram',
      'mailchimp',
    ])
  })
})

describe('channel cards', () => {
  it('treats a channel with no row as not out', () => {
    const [gather] = channelCards([])
    expect(gather.state).toBe('not out')
    expect(gather.actionLabel).toBe('Push it live')
    expect(gather.canUndo).toBe(false)
  })

  it('asks a human to mark a manual channel, not to push it', () => {
    const insta = channelCards([]).find((c) => c.key === 'instagram')!
    expect(insta.actionLabel).toBe('Mark as posted')
    expect(insta.kindLabel).toBe('posted by hand')
    expect(insta.showCaption).toBe(true)
  })

  it('offers a re-push on a stale listing, in the stop colour', () => {
    const fb = channelCards([push('facebook-event', { stale: true })]).find(
      (c) => c.key === 'facebook-event',
    )!
    expect(fb.state).toBe('out of date')
    expect(fb.tone).toBe('stop')
    expect(fb.actionLabel).toBe('Re-push')
    expect(fb.actionPrimary).toBe(true)
  })

  it('drops to a ghost action once a channel is in sync', () => {
    const fb = channelCards([push('facebook-event')]).find((c) => c.key === 'facebook-event')!
    expect(fb.actionLabel).toBe('Push again')
    expect(fb.actionPrimary).toBe(false)
    expect(fb.canUndo).toBe(true)
  })

  it('says who ticked off a manual post, and when', () => {
    const insta = channelCards([
      push('instagram', { byName: 'Tui Ware', when: '2 days ago', note: 'Grid post 24 Aug' }),
    ]).find((c) => c.key === 'instagram')!
    expect(insta.by).toBe('Tui Ware · 2 days ago')
    expect(insta.note).toBe('Grid post 24 Aug')
  })

  it('says nobody has ticked off a manual channel that never went out', () => {
    const hub = channelCards([]).find((c) => c.key === 'eventshub')!
    expect(hub.note).toBe('nobody has ticked this off')
    expect(channelCards([]).find((c) => c.key === 'linktree')!.note).toBe('never pushed')
  })

  // "in sync · never pushed" is a contradiction. A channel that has gone out
  // is described by who put it there and when, not by a stand-in.
  it('has nothing to say about a live channel that carries no note', () => {
    const linktree = channelCards([push('linktree')]).find((c) => c.key === 'linktree')!
    expect(linktree.state).toBe('in sync')
    expect(linktree.note).toBeNull()
  })
})

describe('the header summary', () => {
  it('counts only channels that are live and match the record', () => {
    const s = channelSummary([push('gather'), push('facebook-event', { stale: true })])
    expect(s.outLine).toBe('1 of 10')
    expect(s.stale).toBe(1)
  })

  // A listing that contradicts the record is worse than one that is absent:
  // somebody is reading it and believing it.
  it('lets out-of-date outrank still-to-go-out', () => {
    const s = channelSummary([push('facebook-event', { stale: true })])
    expect(s.headline).toBe('1 listing out of date')
    expect(s.headlineTone).toBe('stop')
  })

  it('counts what is still to go out when nothing is stale', () => {
    const s = channelSummary([push('gather')])
    expect(s.headline).toBe('9 channels still to go out')
    expect(s.headlineTone).toBe('warn')
  })

  it('says everything matches once the lot is out', () => {
    const s = channelSummary(allOut())
    expect(s.headline).toBe('Everything matches the record')
    expect(s.headlineTone).toBe('good')
    expect(s.manualLeft).toBe(0)
  })

  it('counts how many of the missing still need a person', () => {
    expect(channelSummary([]).manualLeft).toBe(2)
  })
})

describe('the promo queue', () => {
  it('leads on anything out of date', () => {
    const row = promoQueueRow({
      id: 'sf',
      name: 'Slow Fold',
      dateLabel: 'Sat 6 Sep',
      channels: [...allOut().slice(1), push('gather', { stale: true })],
    })
    expect(row.note).toBe('1 out of date')
    expect(row.noteTone).toBe('stop')
  })

  it('reads all-out as good and a partial spread as attention', () => {
    const done = promoQueueRow({ id: 'a', name: 'A', dateLabel: 'x', channels: allOut() })
    expect([done.note, done.noteTone]).toEqual(['all 10 channels out', 'good'])
    const part = promoQueueRow({ id: 'b', name: 'B', dateLabel: 'x', channels: [push('gather')] })
    expect([part.note, part.noteTone]).toEqual(['1 of 10 out', 'warn'])
  })
})

describe('the promo plan', () => {
  it('is five beats, and the first two are the gate', () => {
    expect(BEATS.map((b) => b.key)).toEqual(['announce', 'on-sale', 'cut-1', 'cut-2', 'day-before'])
    expect(GATED_BEATS).toBe(2)
  })

  it('names the channels each beat covers', () => {
    const announce = beatRows([])[0]
    expect(announce.channels).toBe(
      'Gather.rsvp · Facebook event · Instagram · Telegram channel · Discord server',
    )
    expect(announce.label).toBe('to do')
  })

  it('marks a worked beat done', () => {
    const rows = beatRows([{ key: 'announce', done: true }])
    expect([rows[0].done, rows[0].label, rows[0].tone]).toEqual([true, 'done', 'good'])
    expect(
      beatsWorkedLine([
        { key: 'announce', done: true },
        { key: 'on-sale', done: false },
      ]),
    ).toBe('1 of 5 beats worked')
  })
})

describe('the pre-post rules', () => {
  it('are the first three of the house content rules', () => {
    expect(PRE_POST_RULES.map((r) => r.title)).toEqual([
      'Vertical video first, twice',
      'Video beats a still',
      'Almost no words on an image',
    ])
  })
})
