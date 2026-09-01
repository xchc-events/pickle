import { describe, expect, it } from 'vitest'
import {
  ASSET_SET,
  allApproved,
  approvedLine,
  assetCards,
  briefFrom,
  briefLine,
  briefTone,
  caption,
  copyFit,
  designHours,
  designQueueRow,
  verticalCuts,
  type EventAsset,
} from './design'

const set = (states: Partial<Record<string, EventAsset['state']>>): EventAsset[] =>
  ASSET_SET.map((s) => ({ key: s.key, state: states[s.key] ?? 'draft', promoterSigned: false }))

const brief = {
  brief: null,
  name: 'Static Bloom',
  format: 'DJs + live',
  spaceName: 'Main',
  std: 30,
  door: 40,
}

describe('the asset set', () => {
  it('is the six pieces the house asks for, ranked by reach', () => {
    expect(ASSET_SET.map((a) => a.tier)).toEqual([
      'hero',
      'hero',
      'lead',
      'support',
      'support',
      'support',
    ])
  })

  it('shows a piece with no row as a draft rather than dropping it', () => {
    const cards = assetCards([], 'hero', { hasPortal: false })
    expect(cards).toHaveLength(2)
    expect(cards.every((c) => c.state === 'draft' && c.label === 'in progress')).toBe(true)
  })

  it('labels the three states the way the chips read', () => {
    const assets = set({ 'vertical-1': 'approved', 'vertical-2': 'review' })
    const [one, two] = assetCards(assets, 'hero', { hasPortal: false })
    expect([one.label, one.tone]).toEqual(['approved', 'good'])
    expect([two.label, two.tone]).toEqual(['needs sign-off', 'warn'])
  })
})

describe('promoter sign-off', () => {
  it('is asked for on hero and lead pieces when there is a portal', () => {
    expect(assetCards([], 'hero', { hasPortal: true })[0].needsPromoterSignOff).toBe(true)
    expect(assetCards([], 'lead', { hasPortal: true })[0].needsPromoterSignOff).toBe(true)
  })

  it('is never asked for on support pieces', () => {
    expect(assetCards([], 'support', { hasPortal: true }).some((c) => c.needsPromoterSignOff)).toBe(
      false,
    )
  })

  // An in-house event has no promoter to sign anything off, which is why the
  // prototype's own Design → On sale gate skips the condition without a portal.
  it('is not asked for on an in-house event', () => {
    expect(assetCards([], 'hero', { hasPortal: false })[0].needsPromoterSignOff).toBe(false)
  })
})

describe('counts', () => {
  it('reads approved against the whole set', () => {
    expect(approvedLine(set({ cover: 'approved', poster: 'approved' }))).toBe('2 of 6 approved')
  })

  it('only calls it done when every piece is signed off', () => {
    const all = Object.fromEntries(ASSET_SET.map((a) => [a.key, 'approved' as const]))
    expect(allApproved(set(all))).toBe(true)
    expect(allApproved(set({ ...all, poster: 'review' }))).toBe(false)
  })

  it('wants both vertical cuts before it reads as good', () => {
    expect(verticalCuts(set({ 'vertical-1': 'approved' }))).toEqual({
      text: '1 of 2 vertical cuts signed off',
      tone: 'warn',
    })
    expect(verticalCuts(set({ 'vertical-1': 'approved', 'vertical-2': 'approved' })).tone).toBe(
      'good',
    )
  })
})

describe('the design queue', () => {
  const base = {
    id: 'sb',
    name: 'Static Bloom',
    dateLabel: 'Sat 6 Sep',
    stage: 3,
    leadName: 'Tui Ware',
    riskNote: null,
    riskKind: 'warn' as const,
  }

  it('calls out an event confirmed with nothing started', () => {
    const row = designQueueRow({ ...base, stage: 2, assets: set({}) })
    expect(row.note).toBe('no brief yet')
    expect(row.noteTone).toBe('warn')
  })

  it('counts what is left once the set is under way', () => {
    const row = designQueueRow({ ...base, assets: set({ cover: 'approved' }) })
    expect(row.note).toBe('5 of 6 left · Sat 6 Sep')
  })

  it('takes the stop colour from a stop-flagged event', () => {
    const row = designQueueRow({
      ...base,
      assets: set({}),
      riskNote: 'Artwork awaiting sign-off 6d',
      riskKind: 'stop',
    })
    expect(row.noteTone).toBe('stop')
  })

  it('says so when nobody leads the creative', () => {
    const row = designQueueRow({ ...base, assets: set({}), leadName: null })
    expect(row.lead).toBe('no design lead')
    expect(row.leadTone).toBe('warn')
  })
})

describe('the brief', () => {
  it('uses the coordinator’s own words when they wrote some', () => {
    expect(briefLine({ ...brief, brief: '  Last show before they tour.  ' })).toBe(
      'Last show before they tour.',
    )
  })

  it('falls back to the event’s own facts rather than a blank', () => {
    expect(briefLine(brief)).toBe(
      'Static Bloom — djs + live at Main. Written once by the coordinator, live from the event record.',
    )
  })

  it('takes the from-price off the subsidised tier, not the standard one', () => {
    expect(briefFrom({ std: 30, door: 40 })).toBe('$24')
  })

  it('changes the tone words for a seated room', () => {
    expect(briefTone('Cabaret')).toEqual(['warm', 'seated', 'unhurried'])
    expect(briefTone('DJs')).toEqual(['warm', 'grainy', 'not clubby'])
  })
})

describe('written once, cut to fit', () => {
  it('measures the one caption against every platform’s limit', () => {
    const text = caption(brief)
    const rows = copyFit(text, 'Static Bloom — Sat 6 Sep')
    expect(rows.map((r) => r.label)).toEqual([
      'Facebook',
      'Instagram',
      'Eventfinda',
      'Gather.rsvp',
      'Mailchimp subject',
    ])
    expect(rows[0].value).toBe('full text')
    expect(rows[1].value).toBe(`${text.length} / 2,200`)
  })

  it('flags a platform the caption does not fit', () => {
    const long = 'x'.repeat(400)
    const rows = copyFit(long, 'short')
    expect(rows.find((r) => r.label === 'Eventfinda')?.tone).toBe('good')
    expect(rows.find((r) => r.label === 'Gather.rsvp')?.tone).toBe('warn')
  })

  it('flags a subject line past sixty characters', () => {
    expect(copyFit('x', 'y'.repeat(61)).at(-1)?.tone).toBe('warn')
  })
})

describe('design hours', () => {
  it('reads nothing logged as zero against the estimate', () => {
    expect(designHours({ est: 6, actual: null })).toEqual({ text: '0 of 6h', pct: 0, over: false })
  })

  it('flags an overrun and caps the bar', () => {
    expect(designHours({ est: 6, actual: 7.5 })).toEqual({
      text: '7.5 of 6h',
      pct: 100,
      over: true,
    })
  })

  it('has nothing to say without a task line', () => {
    expect(designHours(undefined).text).toBe('—')
  })
})
