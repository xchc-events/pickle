import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { ago, dateLabel, days as dayLabel } from './format'
import { caption } from './design'
import { daysBetween } from './pipeline'
import type { SessionUser } from './session'
import {
  PRE_POST_RULES,
  beatRows,
  beatsWorkedLine,
  channelCards,
  channelSummary,
  promoQueueRow,
  type BeatRow,
  type ChannelCard,
  type ChannelSummary,
  type EventChannel,
  type PromoQueueRow,
} from './promo'

/**
 * Loads Promotion.
 *
 * Which channels the venue posts to, how each is handled and what the promo
 * plan asks for are house standard and come from src/lib/promo.ts. Only what
 * happened to this event on each channel comes from the database.
 */

export interface PromoEvent {
  id: string
  name: string
  dateLabel: string
  spaceName: string
  /** "16 days out", "tonight", "past". */
  doorLine: string
  leadName: string | null
  /** The lead's own contact details — set on their account in Admin. */
  leadEmail: string | null
  leadPhone: string | null
  summary: ChannelSummary
  channels: ChannelCard[]
  beats: BeatRow[]
  beatsWorked: string
  /** The listing copy from Design, for the channels a human posts by hand. */
  caption: string
}

export interface PromoView {
  queue: PromoQueueRow[]
  event: PromoEvent | null
  rules: typeof PRE_POST_RULES
}

const doorLine = (daysOut: number): string =>
  daysOut > 0 ? `${dayLabel(daysOut)} out` : daysOut === 0 ? 'tonight' : 'past'

export async function loadPromo(user: SessionUser, wantedId?: string): Promise<PromoView> {
  // Promotion takes an event from the enquiry on: a tour can be announced
  // before this date's terms land, and each part of an event now moves on its
  // own. The one thing that waits is Gather.rsvp — tickets do not go on sale
  // until the booking is confirmed, which `pushChannel` refuses rather than
  // this list hiding. A concluded event has nothing left to push.
  const events = await db.event.findMany({
    where: { AND: [eventScope(user), { concluded: false }] },
    include: {
      space: true,
      channels: { include: { by: true } },
      beats: true,
      leads: {
        include: { person: { include: { user: { select: { email: true, phone: true } } } } },
      },
    },
    orderBy: { date: 'asc' },
  })

  const now = new Date()
  const flatten = (rows: (typeof events)[number]['channels']): EventChannel[] =>
    rows.map((c) => ({
      channel: c.channel,
      live: c.live,
      stale: c.stale,
      note: c.note,
      byName: c.by?.name ?? null,
      when: c.at ? ago(c.at, now) : null,
    }))

  const queue = events.map((e) =>
    promoQueueRow({
      id: e.id,
      name: e.name,
      dateLabel: dateLabel(e.date),
      channels: flatten(e.channels),
    }),
  )

  const row = events.find((e) => e.id === wantedId) ?? events[0]
  if (!row) return { queue, event: null, rules: PRE_POST_RULES }

  const channels = flatten(row.channels)
  const beats = row.beats.map((b) => ({ key: b.key, done: b.done }))
  const promoLead = row.leads.find((l) => l.role === 'PROMO')

  return {
    queue,
    rules: PRE_POST_RULES,
    event: {
      id: row.id,
      name: row.name,
      dateLabel: dateLabel(row.date),
      spaceName: row.space.name,
      doorLine: doorLine(daysBetween(now, row.date)),
      leadName: promoLead?.person.name ?? null,
      leadEmail: promoLead?.person.user?.email ?? null,
      leadPhone: promoLead?.person.user?.phone ?? null,
      summary: channelSummary(channels),
      channels: channelCards(channels),
      beats: beatRows(beats),
      beatsWorked: beatsWorkedLine(beats),
      caption: caption({
        brief: row.brief,
        name: row.name,
        format: row.format,
        spaceName: row.space.name,
        std: row.std,
        door: row.door,
      }),
    },
  }
}
