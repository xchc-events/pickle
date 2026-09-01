/**
 * The promotion module's house standard, and the derivations over it.
 *
 * Ported from `PLATFORMS`, `BEATS` and `promoVals()` in the design prototype
 * (docs/design-handoff/design/Pickle Prototype.dc.html, near lines 3011 and
 * 6244).
 *
 * Ten channels come off one record. Which channels, how each is handled and
 * what the plan asks for are house standard and live here; a `ChannelPush`
 * row stores only what happened to one event on one channel, and a `Beat` row
 * only whether that beat has been worked.
 *
 * Pure functions over plain shapes — no database, no formatting of money.
 */

import { CONTENT_RULES } from './design'

export type ChannelKind = 'api' | 'manual'
export type Tone = 'good' | 'warn' | 'stop' | 'plain'

export interface PlatformSpec {
  /** Stable key, stored on the ChannelPush row. */
  key: string
  name: string
  /** Phosphor icon, regular weight. */
  icon: string
  /** Whether it syncs itself or waits for a human. */
  kind: ChannelKind
  /** How this one is handled, in the venue's own words. */
  blurb: string
  /**
   * Whether a change to the event record puts this listing out of date.
   *
   * A one-off post or send was true when it went out and does not become
   * wrong; Gather.rsvp is the record's own front end, so it cannot disagree
   * with it. Everything else is a standing listing that has to be re-pushed.
   */
  mirrors: boolean
}

export const PLATFORMS: readonly PlatformSpec[] = [
  {
    key: 'gather',
    name: 'Gather.rsvp',
    icon: 'ph-ticket',
    kind: 'api',
    blurb: 'Tickets, door list and check-ins. The source of truth — everything else points here.',
    mirrors: false,
  },
  {
    key: 'facebook-event',
    name: 'Facebook event',
    icon: 'ph-facebook-logo',
    kind: 'api',
    blurb:
      'Event object created and updated over the Graph API. Cover, times and description all mirrored.',
    mirrors: true,
  },
  {
    key: 'instagram',
    name: 'Instagram',
    icon: 'ph-instagram-logo',
    kind: 'manual',
    blurb:
      'No event API worth having. We hold the caption and the cuts; a human posts and ticks it off.',
    mirrors: false,
  },
  {
    key: 'eventfinda',
    name: 'Eventfinda',
    icon: 'ph-calendar-dots',
    kind: 'api',
    blurb: 'Listing pushed and re-pushed. Free tickets only — paid tiers link back to Gather.',
    mirrors: true,
  },
  {
    key: 'eventbrite',
    name: 'Eventbrite',
    // The prototype's PLATFORMS row asks for ph-ticket-fill; only the regular
    // weight is loaded, and Gather already holds ph-ticket. This is the icon
    // the prototype's own integrations panel gives Eventbrite.
    icon: 'ph-armchair',
    kind: 'api',
    blurb: 'Mirror listing for reach. Inventory capped so it cannot oversell against Gather.',
    mirrors: true,
  },
  {
    key: 'eventshub',
    name: 'EventsHub',
    icon: 'ph-calendar-star',
    kind: 'manual',
    blurb: 'Ōtautahi council listing. Web form, moderated, allow two working days.',
    mirrors: true,
  },
  {
    key: 'linktree',
    name: 'Linktree',
    icon: 'ph-link',
    kind: 'api',
    blurb: 'The bio link. Top slot swaps to whatever is on sale next.',
    mirrors: true,
  },
  {
    key: 'telegram',
    name: 'Telegram channel',
    icon: 'ph-telegram-logo',
    kind: 'api',
    blurb: 'Bot posts to the channel. Best conversion of anything we run.',
    mirrors: true,
  },
  {
    key: 'discord',
    name: 'Discord server',
    icon: 'ph-discord-logo',
    kind: 'api',
    blurb: 'Webhook into #gigs, plus a scheduled event in the server.',
    mirrors: true,
  },
  {
    key: 'mailchimp',
    name: 'Mailchimp',
    icon: 'ph-envelope-simple',
    kind: 'api',
    blurb: 'One send per announce and one on-sale reminder. Never more.',
    mirrors: false,
  },
]

export const PLATFORM_KEYS: readonly string[] = PLATFORMS.map((p) => p.key)

const PLATFORM_BY_KEY = new Map(PLATFORMS.map((p) => [p.key, p]))

export const platformSpec = (key: string): PlatformSpec | undefined => PLATFORM_BY_KEY.get(key)

export const platformName = (key: string): string => PLATFORM_BY_KEY.get(key)?.name ?? key

export interface BeatSpec {
  key: string
  name: string
  /** When it goes, relative to the door. */
  when: string
  /** Platform keys this beat covers. */
  channels: readonly string[]
}

/** The promo plan, in order. The first two are a stage gate. */
export const BEATS: readonly BeatSpec[] = [
  {
    key: 'announce',
    name: 'Announce',
    when: 'as soon as it is confirmed',
    channels: ['gather', 'facebook-event', 'instagram', 'telegram', 'discord'],
  },
  {
    key: 'on-sale',
    name: 'On sale',
    when: 'the day tickets go live',
    channels: ['gather', 'linktree', 'eventbrite', 'eventfinda', 'eventshub', 'mailchimp'],
  },
  {
    key: 'cut-1',
    name: 'Vertical cut 1',
    when: 'ten days out',
    channels: ['instagram', 'telegram', 'discord'],
  },
  {
    key: 'cut-2',
    name: 'Vertical cut 2',
    when: 'four days out',
    channels: ['instagram', 'facebook-event'],
  },
  {
    key: 'day-before',
    name: 'Day before',
    when: 'last call',
    channels: ['instagram', 'telegram', 'discord', 'mailchimp'],
  },
]

export const BEAT_KEYS: readonly string[] = BEATS.map((b) => b.key)

/**
 * How many beats have to be worked before an event can leave On sale. The
 * first two — announce and on sale — are the ones an event cannot be without.
 */
export const GATED_BEATS = 2

/** Promotion shows the first three content rules as a pre-flight check. */
export const PRE_POST_RULES = CONTENT_RULES.slice(0, 3)

// -------------------------------------------------------------- channels ---

/** A ChannelPush row, flattened. */
export interface EventChannel {
  channel: string
  live: boolean
  stale: boolean
  note: string | null
  /** Who ticked off a manual post. Auto-sync channels have nobody. */
  byName: string | null
  /** Already formatted for display — "2 days ago". */
  when: string | null
}

export type ChannelState = 'not out' | 'out of date' | 'in sync'

export interface ChannelCard extends PlatformSpec {
  state: ChannelState
  tone: Tone
  /** "auto-sync" / "posted by hand". */
  kindLabel: string
  /**
   * What this listing says about itself — "Start time says 8:30pm · support
   * act missing", "2,140 subscribers". Null where there is nothing to say;
   * a channel that has gone out is described by its "ticked off by" line, so
   * a stand-in here would only contradict it.
   */
  note: string | null
  by: string | null
  /** "Push it live" / "Mark as posted" / "Re-push" / "Re-post" / "Push again". */
  actionLabel: string
  /** Primary while something is owed, ghost once it is only a re-push. */
  actionPrimary: boolean
  /** Only a channel that has gone out can be taken back. */
  canUndo: boolean
  /** A human posting by hand needs the caption to hand. */
  showCaption: boolean
}

const stateOf = (c: EventChannel | undefined): ChannelState =>
  !c?.live ? 'not out' : c.stale ? 'out of date' : 'in sync'

const TONE: Record<ChannelState, Tone> = {
  'not out': 'plain',
  'out of date': 'stop',
  'in sync': 'good',
}

/**
 * One card per channel, in house order. A channel with no row has simply not
 * gone out — the list is what the venue posts to, not what it has posted to.
 */
export function channelCards(channels: EventChannel[]): ChannelCard[] {
  const byKey = new Map(channels.map((c) => [c.channel, c]))
  return PLATFORMS.map((p) => {
    const c = byKey.get(p.key)
    const state = stateOf(c)
    const manual = p.kind === 'manual'
    return {
      ...p,
      state,
      tone: TONE[state],
      kindLabel: manual ? 'posted by hand' : 'auto-sync',
      note: c?.note?.trim()
        ? c.note.trim()
        : state === 'not out'
          ? manual
            ? 'nobody has ticked this off'
            : 'never pushed'
          : null,
      by: c?.byName ? `${c.byName}${c.when ? ` · ${c.when}` : ''}` : null,
      actionLabel:
        state === 'not out'
          ? manual
            ? 'Mark as posted'
            : 'Push it live'
          : state === 'out of date'
            ? 'Re-push'
            : manual
              ? 'Re-post'
              : 'Push again',
      actionPrimary: state !== 'in sync',
      canUndo: state !== 'not out',
      showCaption: manual,
    }
  })
}

export interface ChannelSummary {
  /** Live and matching the record. */
  out: number
  total: number
  /** "7 of 10". */
  outLine: string
  stale: number
  /** Channels not out that need a person, not an API. */
  manualLeft: number
  headline: string
  headlineTone: Tone
}

/**
 * What the header says. Out of date outranks not out: a listing that
 * contradicts the record is worse than one that is absent, because somebody
 * is reading it and believing it.
 */
export function channelSummary(channels: EventChannel[]): ChannelSummary {
  const cards = channelCards(channels)
  const out = cards.filter((c) => c.state === 'in sync').length
  const stale = cards.filter((c) => c.state === 'out of date').length
  const missing = cards.filter((c) => c.state === 'not out')

  const headline = stale
    ? `${stale} listing${stale === 1 ? '' : 's'} out of date`
    : missing.length
      ? `${missing.length} channel${missing.length === 1 ? '' : 's'} still to go out`
      : 'Everything matches the record'

  return {
    out,
    total: cards.length,
    outLine: `${out} of ${cards.length}`,
    stale,
    manualLeft: missing.filter((c) => c.kind === 'manual').length,
    headline,
    headlineTone: stale ? 'stop' : missing.length ? 'warn' : 'good',
  }
}

// ----------------------------------------------------------------- queue ---

/** One row of the event strip across the top of Promotion. */
export interface PromoQueueEvent {
  id: string
  name: string
  dateLabel: string
  channels: EventChannel[]
}

export interface PromoQueueRow {
  id: string
  name: string
  dateLabel: string
  note: string
  noteTone: Tone
}

export function promoQueueRow(e: PromoQueueEvent): PromoQueueRow {
  const s = channelSummary(e.channels)
  return {
    id: e.id,
    name: e.name,
    dateLabel: e.dateLabel,
    note: s.stale
      ? `${s.stale} out of date`
      : s.out === s.total
        ? `all ${s.out} channels out`
        : `${s.out} of ${s.total} out`,
    noteTone: s.stale ? 'stop' : s.out === s.total ? 'good' : 'warn',
  }
}

// ----------------------------------------------------------------- beats ---

/** A Beat row, flattened. */
export interface EventBeat {
  key: string
  done: boolean
}

export interface BeatRow {
  key: string
  name: string
  when: string
  /** Channel names, joined for display. */
  channels: string
  done: boolean
  label: string
  tone: Tone
}

export function beatRows(beats: EventBeat[]): BeatRow[] {
  const done = new Set(beats.filter((b) => b.done).map((b) => b.key))
  return BEATS.map((b) => ({
    key: b.key,
    name: b.name,
    when: b.when,
    channels: b.channels.map(platformName).join(' · '),
    done: done.has(b.key),
    label: done.has(b.key) ? 'done' : 'to do',
    tone: done.has(b.key) ? 'good' : 'plain',
  }))
}

/** "2 of 5 beats worked". */
export const beatsWorkedLine = (beats: EventBeat[]): string =>
  `${beats.filter((b) => b.done).length} of ${BEATS.length} beats worked`
