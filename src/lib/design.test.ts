import { describe, expect, it } from 'vitest'
import { partsFor, type GateArtist, type PartsEvent } from './parts'
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
  missingBiosList,
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
    confirmed: true,
    leadName: 'Tui Ware',
    riskNote: null,
    riskKind: 'warn' as const,
  }

  it('calls out an event confirmed with nothing started', () => {
    const row = designQueueRow({ ...base, assets: set({}) })
    expect(row.note).toBe('no brief yet')
    expect(row.noteTone).toBe('warn')
  })

  /**
   * Design takes events from the enquiry on, because a promoter's tour
   * artwork arrives with it. What it does not do is nag for a brief on a show
   * that may not happen — the reason the queue used to start at Confirmed.
   * It says the booking is unconfirmed instead, so nobody mistakes early work
   * for a sure thing.
   */
  it('does not ask for a brief on a booking that is not confirmed', () => {
    const row = designQueueRow({ ...base, confirmed: false, assets: set({}) })
    expect(row.note).toBe('6 of 6 left · unconfirmed')
    expect(row.noteTone).toBe('plain')
  })

  it('counts what is left once the set is under way', () => {
    const row = designQueueRow({ ...base, assets: set({ cover: 'approved' }) })
    expect(row.note).toBe('5 of 6 left · Sat 6 Sep')
    const early = designQueueRow({ ...base, confirmed: false, assets: set({ cover: 'approved' }) })
    expect(early.note).toBe('5 of 6 left · unconfirmed')
  })

  it('takes the stop colour from a stop-flagged event', () => {
    const row = designQueueRow({
      ...base,
      assets: set({ cover: 'review' }),
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
    expect(designHours(6, [])).toEqual({ text: '0 of 6h', pct: 0, over: false, by: [] })
  })

  it('flags an overrun and caps the bar, and names who logged it', () => {
    expect(designHours(6, [{ personId: 'p1', name: 'Tui Ware', hours: 7.5 }])).toEqual({
      text: '7.5 of 6h',
      pct: 100,
      over: true,
      by: [{ name: 'Tui Ware', hoursLabel: '7.5h' }],
    })
  })

  it('has nothing to say without a task line', () => {
    expect(designHours(undefined, []).text).toBe('—')
  })

  it('sums more than one row for the same person, and ranks the biggest contributor first', () => {
    const line = designHours(10, [
      { personId: 'p1', name: 'Tui Ware', hours: 2 },
      { personId: 'p2', name: 'Reube Katene', hours: 5 },
      { personId: 'p1', name: 'Tui Ware', hours: 1 },
    ])
    expect(line.text).toBe('8 of 10h')
    expect(line.by).toEqual([
      { name: 'Reube Katene', hoursLabel: '5h' },
      { name: 'Tui Ware', hoursLabel: '3h' },
    ])
  })
})

describe('acts to chase', () => {
  it('lists only what is actually missing, per act', () => {
    const rows = missingBiosList(
      [
        { name: 'Static Bloom', hasPromo: true, hasBio: true },
        { name: 'Aro Collective', hasPromo: false, hasBio: true },
        { name: 'Kōura Trio', hasPromo: true, hasBio: false },
        { name: 'The Wheke', hasPromo: false, hasBio: false },
      ],
      false,
    )
    expect(rows).toEqual([
      { name: 'Aro Collective', missing: 'a press shot', chaseNote: null },
      { name: 'Kōura Trio', missing: 'a bio', chaseNote: null },
      { name: 'The Wheke', missing: 'a press shot and a bio', chaseNote: null },
    ])
  })

  it('is empty, not a row for everyone, when nothing is missing', () => {
    expect(
      missingBiosList([{ name: 'Static Bloom', hasPromo: true, hasBio: true }], false),
    ).toEqual([])
  })

  it('names the portal chase only when the promoter has one', () => {
    const [row] = missingBiosList([{ name: 'Aro Collective', hasPromo: false, hasBio: true }], true)
    expect(row?.chaseNote).toBe('chase it in their portal')
  })

  /**
   * The point of E9: the list on Design and the "N acts to chase" cell on
   * Pipeline read the same `hasPromo`/`hasBio` per live act, so they cannot
   * land on different counts the way they did when Connor asked "why is it
   * saying six acts to chase, and then... it doesn't look like there's
   * anything left to do?" (23 Sep 2026).
   */
  it('counts exactly what parts.ts counts for the same acts, live or not', () => {
    const artists: GateArtist[] = [
      { status: 'confirmed', hasPromo: false, hasBio: true, hasTechRider: true },
      { status: 'pencilled', hasPromo: true, hasBio: false, hasTechRider: true },
      { status: 'declined', hasPromo: false, hasBio: false, hasTechRider: false },
    ]

    const partsEvent: PartsEvent = {
      booking: 'confirmed',
      bookingDays: 2,
      concluded: false,
      daysToDoor: 20,
      hasOwner: true,
      dateTbc: false,
      hasSpace: true,
      kind: 'djs',
      promoter: 'Kōura Collective',
      hasPortal: false,
      split: 0.6,
      dealState: 'agreed',
      dealNote: null,
      floor: 500,
      ceil: 1200,
      artists,
      barClose: '11:00pm',
      doors: '8:00pm',
      allOut: '12:00am',
      licence: 'not_required',
      techStatus: 'confirmed',
      leads: { ticketing: true, design: true, promo: true, tech: true },
      // Every piece approved: with one check still failing, this is the case
      // where the cell used to read "art signed off" but named nothing —
      // Connor's actual complaint.
      assets: ASSET_SET.map((a) => ({
        key: a.key,
        state: 'approved' as const,
        promoterSigned: true,
      })),
      artworkFiles: 0,
      channels: [{ live: true, stale: false }],
      beatsDone: 2,
      std: 30,
      ticketsLive: true,
      sold: 40,
      capacity: 220,
      shifts: [{ assigned: true, pencilled: false }],
      hoursLogged: 3,
      tasksWithActual: 1,
      doorCounted: true,
      barClosed: true,
    }

    // The declined act is left out of `acts` here exactly as `liveActs` in
    // parts.ts leaves it out — that is the "same input" the two screens share.
    const liveActs = artists
      .filter((a) => a.status !== 'declined')
      .map((a, i) => ({ name: `Act ${i}`, hasPromo: a.hasPromo, hasBio: a.hasBio }))

    const list = missingBiosList(liveActs, false)
    const designPart = partsFor(partsEvent).find((p) => p.key === 'design')

    expect(list.length).toBe(2)
    expect(designPart?.detail).toBe(`${list.length} acts' bios and pics to chase`)
  })
})
