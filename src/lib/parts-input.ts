import { halvesOf, type ActualFigures } from './actuals'
import { capacityOf } from './ticketing'
import { daysBetween } from './pipeline'
import type { BookingStatus, PartsEvent } from './parts'
import type { ArtistStatus, DealState, LeadKey, LicenceState, TechStatus } from './event-record'
import type { AssetState } from './design'

/**
 * Assembling what the parts read, from a loaded event row.
 *
 * The Pipeline and the event record both show an event's parts. Built
 * longhand in each, the two would drift — the thing finance-input.ts was
 * written to stop happening to the money, and the same reasoning applies:
 * two screens that each decide what "on sale" means are two screens that can
 * disagree about it.
 *
 * Nothing here decides a status. It only reads the row into the shape
 * src/lib/parts.ts works from. Pure, so the reading is tested.
 */

/** The columns the parts need. Structural, so any select that covers it fits. */
export interface PartsRow {
  bookingStatus: string
  bookingStatusSince: Date
  concluded: boolean
  date: Date
  dateTbc: boolean
  kind: string
  format: string
  promoter: string | null
  ownerId: string | null
  split: number
  deal: string
  dealNote: string | null
  barClose: string | null
  doors: string | null
  allOut: string | null
  licence: string
  techStatus: string
  std: number
  sold: number
  space: { name: string; capacity: number; seatedCapacity: number }
  leads: { role: string }[]
  assets: { key: string; state: string; promoterSigned: boolean; signedById: string | null }[]
  channels: { channel: string; live: boolean; stale: boolean }[]
  beats: { done: boolean }[]
  artists: { status: string; payee: { files: { kind: string }[] } | null }[]
  files: { kind: string; assetId: string | null; current: boolean; scan: string }[]
  shifts: { personId: string | null; state: string }[]
  tasks: { actual: number | null }[]
  /** Only counted. */
  hours: unknown[]
}

/** The select that satisfies `PartsRow`. Spread into an event query. */
export const PARTS_SELECT = {
  bookingStatus: true,
  bookingStatusSince: true,
  concluded: true,
  date: true,
  dateTbc: true,
  kind: true,
  format: true,
  promoter: true,
  // `internal` and `promoterId` are what `hasPortalFor` reads — see
  // src/lib/portal-access.ts. They travel with the parts select so every
  // screen that computes `hasPortal` has the columns to do it.
  internal: true,
  promoterId: true,
  ownerId: true,
  split: true,
  deal: true,
  dealNote: true,
  barClose: true,
  doors: true,
  allOut: true,
  licence: true,
  techStatus: true,
  std: true,
  sold: true,
  space: { select: { name: true, capacity: true, seatedCapacity: true } },
  leads: { select: { role: true } },
  assets: { select: { key: true, state: true, promoterSigned: true, signedById: true } },
  channels: { select: { channel: true, live: true, stale: true } },
  beats: { select: { done: true } },
  artists: { select: { status: true, payee: { select: { files: { select: { kind: true } } } } } },
  files: { select: { kind: true, assetId: true, current: true, scan: true } },
  shifts: { select: { personId: true, state: true } },
  tasks: { select: { actual: true } },
  hours: { select: { id: true } },
} as const

/** What the row cannot say for itself. */
export interface PartsExtras {
  /** Whether this promoter has a portal account to be chased in. */
  hasPortal: boolean
  /** Fee floor and ceiling, from `financeVals`. Never worked out here. */
  floor: number
  ceil: number
  /** The night's reconciled figures, where there are any. */
  actual: ActualFigures | null
  now: Date
}

export function partsInputFor(row: PartsRow, x: PartsExtras): PartsEvent {
  const lower = <T extends string>(s: string) => s.toLowerCase() as T
  const leadRoles = new Set(row.leads.map((l) => l.role.toLowerCase()))
  const lead = (key: LeadKey) => leadRoles.has(key)

  // A file counts whether it arrived on the event or on the payee record —
  // an act that sent their bio last time has sent their bio.
  const eventKinds = new Set(row.files.map((f) => f.kind))
  const halves = halvesOf(x.actual)

  return {
    booking: lower<BookingStatus>(row.bookingStatus),
    bookingDays: daysBetween(row.bookingStatusSince, x.now),
    concluded: row.concluded,
    daysToDoor: daysBetween(x.now, row.date),

    hasOwner: row.ownerId !== null,
    dateTbc: row.dateTbc,
    hasSpace: !!row.space.name,
    kind: row.kind,
    promoter: row.promoter,
    hasPortal: x.hasPortal,
    split: row.split,
    dealState: lower<DealState>(row.deal),
    dealNote: row.dealNote,
    floor: x.floor,
    ceil: x.ceil,
    artists: row.artists.map((a) => {
      const kinds = new Set([...eventKinds, ...(a.payee?.files ?? []).map((f) => f.kind)])
      return {
        status: lower<ArtistStatus>(a.status),
        hasPromo: kinds.has('PRESS_SHOT'),
        hasBio: kinds.has('BIO'),
        hasTechRider: kinds.has('RIDER_TECH'),
      }
    }),

    barClose: row.barClose,
    doors: row.doors,
    allOut: row.allOut,
    licence: lower<LicenceState>(row.licence),
    techStatus: lower<TechStatus>(row.techStatus),

    leads: {
      ticketing: lead('ticketing'),
      design: lead('design'),
      promo: lead('promo'),
      tech: lead('tech'),
    },

    assets: row.assets.map((a) => ({
      key: a.key,
      state: lower<AssetState>(a.state),
      promoterSigned: a.promoterSigned,
      signedById: a.signedById,
    })),
    // A file still being scanned has arrived, which is all "assets in" means;
    // one the scan blocked is not artwork anybody can use.
    artworkFiles: row.files.filter((f) => f.kind === 'ARTWORK' && f.current && f.scan !== 'BLOCKED')
      .length,

    channels: row.channels.map((c) => ({ live: c.live, stale: c.stale })),
    beatsDone: row.beats.filter((b) => b.done).length,

    std: row.std,
    // Gather.rsvp is the source of truth — tickets are on sale when its
    // channel is live, not when any listing is.
    ticketsLive: row.channels.some((c) => c.channel === 'gather' && c.live),
    sold: row.sold,
    capacity: capacityOf(row.space, row.format),

    shifts: row.shifts.map((s) => ({
      // A state, not merely a person on the shift — R6 put a shift through
      // OFFERED, person set, before ASSIGNED, and nobody has said yes until
      // it gets there.
      assigned: s.state === 'ASSIGNED' || s.state === 'DONE',
      pencilled: s.state === 'ASKED',
    })),

    hoursLogged: row.hours.length,
    tasksWithActual: row.tasks.filter((t) => (t.actual ?? 0) > 0).length,
    doorCounted: halves.door !== null,
    barClosed: halves.bar !== null,
  }
}
