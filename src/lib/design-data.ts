import 'server-only'
import { db } from './db'
import { eventScope } from './scope'
import { dateLabel } from './format'
import { ROLE_LABEL } from './constants'
import { commentsFor, type CommentRow } from './comments-data'
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
  maySignOff,
  missingBiosList,
  verticalCuts,
  type AssetCard,
  type CopyFit,
  type DesignQueueRow,
  type EventAsset,
  type HoursLine,
  type MissingBioRow,
} from './design'
import { CONTENT_RULES } from './design'

/** The design team's own name, as it is written onto an `HourEntry.role`. */
const DESIGN_TEAM = ROLE_LABEL.design

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
  /** The lead's own contact details — set on their account in Admin. */
  leadEmail: string | null
  leadPhone: string | null
  approved: string
  hero: AssetCard[]
  lead: AssetCard[]
  support: AssetCard[]
  verticals: { text: string; tone: 'good' | 'warn' | 'stop' | 'plain' }
  brief: { line: string; tone: string[]; from: string; mustAppear: readonly string[] }
  hours: HoursLine
  /** Live acts still missing a press shot or a bio. Empty when none are. */
  missingBios: MissingBioRow[]
  caption: string
  copy: CopyFit[]
  /**
   * D6 — whether the signed-in user may Approve, Ask for a change or Reopen
   * on this event: its owner, or a promoter of its organisation. One flag
   * for the whole event, not per piece, because `maySignOff` never looks at
   * the piece — see src/lib/design.ts.
   */
  maySignOff: boolean
  /** D5 — the general design thread, under the brief rather than a piece. */
  generalComments: CommentRow[]
}

export interface DesignView {
  queue: DesignQueueRow[]
  event: DesignEvent | null
  leadOptions: LeadOption[]
  rules: typeof CONTENT_RULES
  /** Whether R2 is configured on this install — checked once, in the page. */
  storageReady: boolean
}

const flatten = (
  assets: { key: string; state: string; promoterSigned: boolean; signedById: string | null }[],
): EventAsset[] =>
  assets.map((a) => ({
    key: a.key,
    state: a.state.toLowerCase() as EventAsset['state'],
    promoterSigned: a.promoterSigned,
    signedById: a.signedById,
  }))

export async function loadDesign(
  user: SessionUser,
  wantedId: string | undefined,
  storageReady: boolean,
): Promise<DesignView> {
  // Design takes an event from the enquiry on. It used to start at Confirmed,
  // on the reasoning that briefing an event before its terms are agreed is
  // work done on a show that may not happen — but a promoter sends the artwork
  // for their whole tour with the enquiry, and it has to land somewhere. The
  // queue row says an unconfirmed booking is unconfirmed rather than chasing
  // a brief for it; see `designQueueRow`. A settled event has nothing left to
  // sign off, so it drops off the queue rather than sitting at the front of it.
  const events = await db.event.findMany({
    where: { AND: [eventScope(user), { concluded: false }] },
    include: {
      space: true,
      assets: true,
      tasks: true,
      leads: {
        include: { person: { include: { user: { select: { email: true, phone: true } } } } },
      },
      // A file counts whether it arrived on the event or on the payee record —
      // an act that sent their bio last time has sent their bio. Same rule
      // parts-input.ts loads `hasPromo`/`hasBio` by.
      files: { where: { current: true, scan: 'CLEAN' }, select: { kind: true } },
      artists: {
        select: {
          name: true,
          status: true,
          payee: {
            select: { files: { where: { current: true, scan: 'CLEAN' }, select: { kind: true } } },
          },
        },
      },
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
      confirmed: e.bookingStatus === 'CONFIRMED',
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
  if (!row) return { queue, event: null, leadOptions, rules: CONTENT_RULES, storageReady }

  const assets = flatten(row.assets)
  const portal = hasPortal(row.promoter)

  // The artwork attached to each piece, the hours the design team has logged
  // against this event, and its comment threads — independent queries,
  // fetched together.
  const [artworkFiles, loggedHours, comments] = await Promise.all([
    db.storedFile.findMany({
      where: { eventId: row.id, kind: 'ARTWORK', current: true, scan: 'CLEAN' },
      include: { asset: { select: { key: true } } },
    }),
    db.hourEntry.findMany({
      where: { eventId: row.id, role: DESIGN_TEAM },
      select: { personId: true, hours: true, person: { select: { name: true } } },
    }),
    commentsFor(row.id),
  ])

  const artwork = new Map(
    artworkFiles
      .filter((f) => f.asset)
      .map((f) => [f.asset!.key, { id: f.id, name: f.name, size: f.size, version: f.version }]),
  )
  // `comments.byAsset` is keyed by Asset.id; row.assets is what maps a
  // house key back to the row it came from.
  const commentsByKey = new Map(row.assets.map((a) => [a.key, comments.byAsset.get(a.id) ?? []]))

  const withExtras = (cards: AssetCard[]): AssetCard[] =>
    cards.map((c) => ({
      ...c,
      file: artwork.get(c.key) ?? null,
      comments: commentsByKey.get(c.key) ?? [],
    }))
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

  // Live acts still missing a press shot or a bio — the same computation
  // parts.ts's design() counts for the Pipeline cell, over the same files.
  const eventKinds = new Set(row.files.map((f) => f.kind))
  const liveActs = row.artists
    .filter((a) => a.status !== 'DECLINED')
    .map((a) => {
      const kinds = new Set([...eventKinds, ...(a.payee?.files ?? []).map((f) => f.kind)])
      return { name: a.name, hasPromo: kinds.has('PRESS_SHOT'), hasBio: kinds.has('BIO') }
    })

  return {
    queue,
    leadOptions,
    rules: CONTENT_RULES,
    storageReady,
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
      leadEmail: lead?.person.user?.email ?? null,
      leadPhone: lead?.person.user?.phone ?? null,
      approved: approvedLine(assets),
      hero: withExtras(assetCards(assets, 'hero', { hasPortal: portal })),
      lead: withExtras(assetCards(assets, 'lead', { hasPortal: portal })),
      support: withExtras(assetCards(assets, 'support', { hasPortal: portal })),
      verticals: verticalCuts(assets),
      brief: {
        line: briefLine(facts),
        tone: briefTone(row.format),
        from: briefFrom(row),
        mustAppear: MUST_APPEAR,
      },
      hours: designHours(
        task?.est,
        loggedHours.map((h) => ({ personId: h.personId, name: h.person.name, hours: h.hours })),
      ),
      missingBios: missingBiosList(liveActs, portal),
      caption: caption(facts),
      copy: copyFit(caption(facts), `${row.name} — ${dateLabel(row.date)}`),
      maySignOff: maySignOff(user, { ownerId: row.ownerId, promoterId: row.promoterId }),
      generalComments: comments.general,
    },
  }
}
