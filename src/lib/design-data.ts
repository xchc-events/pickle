import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { dateLabel } from './format'
import type { SessionUser } from './session'
import {
  DESIGN_TASK,
  MUST_APPEAR,
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
  type AssetCard,
  type CopyFit,
  type DesignQueueRow,
  type EventAsset,
  type HoursLine,
} from './design'
import { CONTENT_RULES } from './design'

/**
 * Loads Design.
 *
 * The house standard — what the set is, why each piece is asked for, what
 * every asset must carry — comes from src/lib/design.ts. Only what has
 * happened to this event's pieces comes from the database.
 */

export interface LeadOption {
  personId: string
  name: string
  initials: string
}

export interface DesignEvent {
  id: string
  name: string
  dateLabel: string
  promoter: string
  spaceName: string
  format: string
  /** The lead who owns every asset on this event. */
  leadName: string | null
  leadInitials: string | null
  leadPersonId: string | null
  approved: string
  hero: AssetCard[]
  lead: AssetCard[]
  support: AssetCard[]
  verticals: { text: string; tone: 'good' | 'warn' | 'stop' | 'plain' }
  brief: { line: string; tone: string[]; from: string; mustAppear: readonly string[] }
  hours: HoursLine
  caption: string
  copy: CopyFit[]
}

export interface DesignView {
  queue: DesignQueueRow[]
  event: DesignEvent | null
  leadOptions: LeadOption[]
  rules: typeof CONTENT_RULES
}

const flatten = (assets: { key: string; state: string; promoterSigned: boolean }[]): EventAsset[] =>
  assets.map((a) => ({
    key: a.key,
    state: a.state.toLowerCase() as EventAsset['state'],
    promoterSigned: a.promoterSigned,
  }))

export async function loadDesign(user: SessionUser, wantedId?: string): Promise<DesignView> {
  // Design starts at Confirmed and stops at the door: before terms are agreed
  // there is nothing to brief, and briefing an event anyway is how work gets
  // done on events that never happen. A settled one has nothing left to sign
  // off, so it drops off the queue rather than sitting at the front of it.
  const events = await db.event.findMany({
    where: { AND: [eventScope(user), { stage: { gte: 2 }, concluded: false }] },
    include: {
      space: true,
      assets: true,
      tasks: true,
      leads: { include: { person: true } },
    },
    orderBy: { date: 'asc' },
  })

  // Whether this event's promoter has a portal to sign the creative off in.
  const externals = await db.user.findMany({
    where: { role: 'PROMOTER', promoter: { not: null } },
    select: { promoter: true },
  })
  const hasPortal = (promoter: string | null) =>
    externals.some((u) => u.promoter && (promoter ?? '').includes(u.promoter))

  const designLead = (e: (typeof events)[number]) => e.leads.find((l) => l.role === 'DESIGN')

  const queue = events.map((e) =>
    designQueueRow({
      id: e.id,
      name: e.name,
      dateLabel: dateLabel(e.date),
      stage: e.stage,
      assets: flatten(e.assets),
      leadName: designLead(e)?.person.name ?? null,
      riskNote: e.riskNote,
      riskKind: e.riskKind === 'STOP' ? 'stop' : 'warn',
    }),
  )

  const leadOptions: LeadOption[] = (
    await db.user.findMany({
      where: { role: { not: 'PROMOTER' }, active: true, personId: { not: null } },
      include: { person: true },
      orderBy: { name: 'asc' },
    })
  ).map((u) => ({
    personId: u.personId!,
    name: u.person?.name ?? u.name ?? u.email,
    initials: u.person?.initials ?? '—',
  }))

  const row = events.find((e) => e.id === wantedId) ?? events[0]
  if (!row) return { queue, event: null, leadOptions, rules: CONTENT_RULES }

  const assets = flatten(row.assets)
  const portal = hasPortal(row.promoter)

  // The artwork attached to each piece. Keyed by asset key rather than by
  // asset id so a piece with no Asset row yet still lines up.
  const artwork = new Map(
    (
      await db.storedFile.findMany({
        where: { eventId: row.id, kind: 'ARTWORK', current: true, scan: 'CLEAN' },
        include: { asset: { select: { key: true } } },
      })
    )
      .filter((f) => f.asset)
      .map((f) => [f.asset!.key, { id: f.id, name: f.name, size: f.size, version: f.version }]),
  )

  const withArtwork = (cards: AssetCard[]): AssetCard[] =>
    cards.map((c) => ({ ...c, file: artwork.get(c.key) ?? null }))
  const facts = {
    brief: row.brief,
    name: row.name,
    format: row.format,
    spaceName: row.space.name,
    std: row.std,
    door: row.door,
  }
  const lead = designLead(row)
  const task = row.tasks.find((t) => t.name === DESIGN_TASK)

  return {
    queue,
    leadOptions,
    rules: CONTENT_RULES,
    event: {
      id: row.id,
      name: row.name,
      dateLabel: dateLabel(row.date),
      promoter: row.promoter ?? '',
      spaceName: row.space.name,
      format: row.format,
      leadName: lead?.person.name ?? null,
      leadInitials: lead?.person.initials ?? null,
      leadPersonId: lead?.personId ?? null,
      approved: approvedLine(assets),
      hero: withArtwork(assetCards(assets, 'hero', { hasPortal: portal })),
      lead: withArtwork(assetCards(assets, 'lead', { hasPortal: portal })),
      support: withArtwork(assetCards(assets, 'support', { hasPortal: portal })),
      verticals: verticalCuts(assets),
      brief: {
        line: briefLine(facts),
        tone: briefTone(row.format),
        from: briefFrom(row),
        mustAppear: MUST_APPEAR,
      },
      hours: designHours(task ? { est: task.est, actual: task.actual } : undefined),
      caption: caption(facts),
      copy: copyFit(caption(facts), `${row.name} — ${dateLabel(row.date)}`),
    },
  }
}
