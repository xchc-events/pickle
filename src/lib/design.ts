/**
 * The design module's house standard, and the derivations over it.
 *
 * Ported from `ASSET_SET`, `CONTENT_RULES` and `designVals()` in the design
 * prototype (docs/design-handoff/design/Pickle Prototype.dc.html, near lines
 * 2990 and 5847).
 *
 * The asset set and the content rules are specification: they are what the
 * venue asks of every event, so they live here once rather than being copied
 * onto each event record. An `Asset` row stores only which piece it is and
 * what state it is in — revising the house standard revises every event.
 *
 * Everything in this file is a pure function over plain shapes so it can be
 * tested without a database.
 */

import { tiers } from './finance'

export type AssetTier = 'hero' | 'lead' | 'support'
export type AssetState = 'draft' | 'review' | 'approved'

export interface AssetSpec {
  /** Stable key, stored on the Asset row. */
  key: string
  name: string
  /** Format spec — the thing a designer needs before they open anything. */
  spec: string
  tier: AssetTier
  /** Phosphor icon, regular weight. */
  icon: string
  /** Why the house asks for it. This is the argument, not a description. */
  why: string
}

/**
 * The set, in checklist order. Tiers rank by reach, not by effort: hero is
 * the only tier that travels past the venue's own followers.
 */
export const ASSET_SET: readonly AssetSpec[] = [
  {
    key: 'vertical-1',
    name: 'Vertical cut 1 — the hook',
    spec: '9:16 · 15–30s · shot on a phone',
    tier: 'hero',
    icon: 'ph-device-mobile-camera',
    why: 'The only asset that reaches people who do not already follow you. Sound on, face or room in the first second, no title card.',
  },
  {
    key: 'vertical-2',
    name: 'Vertical cut 2 — different angle',
    spec: '9:16 · 10–20s · second hook',
    tier: 'hero',
    icon: 'ph-device-mobile-camera',
    why: 'Same night, different moment and a different opening line. Posted on another day so the algorithm treats it as new.',
  },
  {
    key: 'cover',
    name: 'Facebook / event cover',
    spec: '1920 × 1005 · almost no text',
    tier: 'lead',
    icon: 'ph-image',
    why: 'The one still that has to work — it is the event page, the share card and the listing thumbnail. Name and date only.',
  },
  {
    key: 'story',
    name: 'Instagram story',
    spec: '1080 × 1920',
    tier: 'support',
    icon: 'ph-device-mobile',
    why: 'Link sticker to Gather.rsvp. Reshare the vertical cuts here rather than making something new.',
  },
  {
    key: 'poster',
    name: 'Poster A2',
    spec: '420 × 594 mm · print',
    tier: 'support',
    icon: 'ph-image-square',
    why: 'For the walls, not the feed. Print is the one place detail earns its space.',
  },
  {
    key: 'listing',
    name: 'Listing copy',
    spec: 'one text, five lengths',
    tier: 'support',
    icon: 'ph-text-align-left',
    why: 'Written once on the event record and cut to fit each platform.',
  },
]

export const ASSET_KEYS: readonly string[] = ASSET_SET.map((a) => a.key)

const SPEC_BY_KEY = new Map(ASSET_SET.map((a) => [a.key, a]))

export const assetSpec = (key: string): AssetSpec | undefined => SPEC_BY_KEY.get(key)

/** House doctrine. Rendered on Design in full, and on Promotion as the first three. */
export const CONTENT_RULES: readonly { title: string; body: string }[] = [
  {
    title: 'Vertical video first, twice',
    body: 'Two different short-form cuts outrank everything else. They are the only assets that travel past your own followers.',
  },
  {
    title: 'Video beats a still',
    body: 'A rough clip of the actual room outperforms a perfect graphic. If you only have time for one thing, film something.',
  },
  {
    title: 'Almost no words on an image',
    body: 'Name and date. Everything else belongs in the caption — text on an image is read by nobody and punished by every feed.',
  },
  {
    title: 'Real over polished',
    body: 'Phone footage, soundcheck, load-in, actual faces. Authentic content out-performs polished content, and AI-generated imagery reads as a scam to this audience.',
  },
  {
    title: 'One idea per asset',
    body: 'If a cut is trying to say two things, it is two cuts.',
  },
]

// ----------------------------------------------------------------- cards ---

/** An Asset row, flattened. */
export interface EventAsset {
  key: string
  state: AssetState
  /** Given in the promoter's portal, never by the venue. */
  promoterSigned: boolean
}

export type Tone = 'good' | 'warn' | 'stop' | 'plain'

/** The artwork itself, once somebody has uploaded it. */
export interface ArtworkFile {
  id: string
  name: string
  size: number
  version: number
}

export interface AssetCard extends AssetSpec {
  state: AssetState
  /** What the chip says: "approved" / "needs sign-off" / "in progress". */
  label: string
  tone: Tone
  promoterSigned: boolean
  /**
   * The file attached to this piece, if there is one.
   *
   * Left off by `assetCards`, which is pure and knows nothing about storage,
   * and attached in design-data.ts. A piece can be approved without a file
   * here — the sign-off is a decision about work, and the work sometimes
   * lives somewhere else for good reasons.
   */
  file?: ArtworkFile | null
  /**
   * Whether to show the promoter sign-off line at all.
   *
   * The prototype shows it on every hero and lead piece, but its own
   * Design → On sale gate skips the condition when there is no promoter
   * portal — and on an in-house event there is nobody to sign off. The gate
   * is the load-bearing statement of intent, so the line follows it.
   */
  needsPromoterSignOff: boolean
}

const LABEL: Record<AssetState, string> = {
  approved: 'approved',
  review: 'needs sign-off',
  draft: 'in progress',
}
const TONE: Record<AssetState, Tone> = { approved: 'good', review: 'warn', draft: 'plain' }

/**
 * The cards for one tier, in house order. An event missing an asset row shows
 * the piece as a draft rather than dropping it off the checklist — the set is
 * what is asked for, not what happens to exist.
 */
export function assetCards(
  assets: EventAsset[],
  tier: AssetTier,
  opts: { hasPortal: boolean },
): AssetCard[] {
  const byKey = new Map(assets.map((a) => [a.key, a]))
  return ASSET_SET.filter((s) => s.tier === tier).map((s) => {
    const a = byKey.get(s.key)
    const state = a?.state ?? 'draft'
    return {
      ...s,
      state,
      label: LABEL[state],
      tone: TONE[state],
      promoterSigned: a?.promoterSigned ?? false,
      needsPromoterSignOff: opts.hasPortal && (s.tier === 'hero' || s.tier === 'lead'),
    }
  })
}

const stateOf = (assets: EventAsset[], key: string): AssetState =>
  assets.find((a) => a.key === key)?.state ?? 'draft'

export const approvedCount = (assets: EventAsset[]): number =>
  ASSET_KEYS.filter((k) => stateOf(assets, k) === 'approved').length

/** "4 of 6 approved". */
export const approvedLine = (assets: EventAsset[]): string =>
  `${approvedCount(assets)} of ${ASSET_SET.length} approved`

/** Everything on the checklist is signed off. This is what moves the event on. */
export const allApproved = (assets: EventAsset[]): boolean =>
  approvedCount(assets) === ASSET_SET.length

/**
 * The vertical cuts line. Both are needed: one cut is not a promo plan, so
 * anything short of the pair reads as attention, not progress.
 */
export function verticalCuts(assets: EventAsset[]): { text: string; tone: Tone } {
  const hero = ASSET_SET.filter((s) => s.tier === 'hero')
  const ok = hero.filter((s) => stateOf(assets, s.key) === 'approved').length
  return {
    text: `${ok} of ${hero.length} vertical cuts signed off`,
    tone: ok === hero.length ? 'good' : 'warn',
  }
}

// ----------------------------------------------------------------- queue ---

/** One row of the event strip across the top of Design. */
export interface DesignQueueEvent {
  id: string
  name: string
  dateLabel: string
  stage: number
  assets: EventAsset[]
  leadName: string | null
  riskNote: string | null
  riskKind: 'warn' | 'stop'
}

export interface DesignQueueRow {
  id: string
  name: string
  note: string
  noteTone: Tone
  lead: string
  leadTone: Tone
}

/**
 * The queue note. "No brief yet" is its own state and outranks a count:
 * an event sitting at Confirmed with nothing started is a different problem
 * from one halfway through its set.
 */
export function designQueueRow(e: DesignQueueEvent): DesignQueueRow {
  const left = ASSET_KEYS.filter((k) => stateOf(e.assets, k) !== 'approved').length
  const started = ASSET_KEYS.some((k) => stateOf(e.assets, k) !== 'draft')
  const noBrief = e.stage === 2 && !started

  const note = noBrief
    ? 'no brief yet'
    : left
      ? `${left} of ${ASSET_SET.length} left · ${e.dateLabel}`
      : 'all signed off'

  const noteTone: Tone = noBrief
    ? 'warn'
    : left
      ? e.riskKind === 'stop' && e.riskNote
        ? 'stop'
        : 'plain'
      : 'good'

  return {
    id: e.id,
    name: e.name,
    note,
    noteTone,
    lead: e.leadName ?? 'no design lead',
    leadTone: e.leadName ? 'plain' : 'warn',
  }
}

// ----------------------------------------------------------------- brief ---

/** Tone words for the brief. The room the format asks for, not a mood board. */
export const briefTone = (format: string): string[] =>
  format === 'Cabaret' ? ['warm', 'seated', 'unhurried'] : ['warm', 'grainy', 'not clubby']

/**
 * The one-liner. Written once by the coordinator on the event record; where
 * nobody has written one, the event's own facts stand in rather than a blank.
 */
export const briefLine = (e: {
  brief: string | null
  name: string
  format: string
  spaceName: string
}): string =>
  e.brief?.trim()
    ? e.brief.trim()
    : `${e.name} — ${e.format.toLowerCase()} at ${e.spaceName}. Written once by the coordinator, live from the event record.`

/** "From $24" — the subsidised tier, which is the honest lowest price. */
export const briefFrom = (e: { std: number; door: number }): string => `$${tiers(e).sub}`

/** Every asset carries these, on every event. Not negotiable per booking. */
export const MUST_APPEAR: readonly string[] = [
  'XCHC mark + promoter mark',
  'R18 · licensed premises',
  'Gather ticket link',
  'Care & Harm Reduction line',
]

// ------------------------------------------------------------------ copy ---

/**
 * The caption, composed from the record. "Written once, cut to fit" is the
 * claim; this is the once.
 */
export const caption = (e: {
  brief: string | null
  name: string
  format: string
  spaceName: string
  std: number
  door: number
}): string =>
  `${briefLine(e)} Four ticket tiers from ${briefFrom(e)} — pick the one that fits your week. R18, licensed, care team on site.`

/**
 * Where each platform cuts the text off.
 *
 * The prototype hard-codes the resulting figures. Measuring the real caption
 * against the real limit is the same panel and it cannot go stale — which is
 * the whole point of writing the copy once.
 */
export const COPY_LIMITS: readonly { label: string; limit: number | null }[] = [
  { label: 'Facebook', limit: null },
  { label: 'Instagram', limit: 2200 },
  { label: 'Eventfinda', limit: 500 },
  { label: 'Gather.rsvp', limit: 300 },
]

export interface CopyFit {
  label: string
  value: string
  tone: Tone
}

/** One row per platform: how long the caption is against what it allows. */
export function copyFit(text: string, subject: string): CopyFit[] {
  const n = text.trim().length
  const rows: CopyFit[] = COPY_LIMITS.map((c) =>
    c.limit === null
      ? { label: c.label, value: 'full text', tone: 'good' }
      : {
          label: c.label,
          value: `${n} / ${c.limit.toLocaleString('en-NZ')}`,
          tone: n <= c.limit ? 'good' : 'warn',
        },
  )
  const s = subject.trim().length
  rows.push({
    label: 'Mailchimp subject',
    value: `${s} / 60`,
    tone: s <= 60 ? 'good' : 'warn',
  })
  return rows
}

// ----------------------------------------------------------------- hours ---

/** The Design & comms task line, the module's own cost. */
export const DESIGN_TASK = 'Design & comms'

export interface HoursLine {
  text: string
  /** 0–100. */
  pct: number
  over: boolean
}

export function designHours(task: { est: number; actual: number | null } | undefined): HoursLine {
  if (!task || task.est <= 0) return { text: '—', pct: 0, over: false }
  const actual = task.actual ?? 0
  return {
    text: `${actual} of ${task.est}h`,
    pct: Math.min(100, Math.round((actual / task.est) * 100)),
    over: actual > task.est,
  }
}
