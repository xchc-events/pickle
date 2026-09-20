import 'server-only'
import { db } from './db'
import type { SessionUser } from './session'
import {
  HOUSE_TASKS,
  internalContact,
  mayStartEnquiry,
  startedLine,
  type CleanEnquiry,
  type FieldKey,
  type IntakeSpace,
} from './intake'
import type { ArtistStatus, BookingModel } from '@/generated/prisma/client'

/**
 * Reading intake's pickers, and turning a clean enquiry into an `Event`.
 *
 * `loadIntakeOptions` is the other half of the whitelist in intake.ts: an
 * outside account never sees who else's people or organisations exist,
 * because the query for them never runs — not because the form hides a
 * field. Hiding a control is not access control; not asking the database is.
 *
 * `createEnquiry` re-derives the organisation, and clears the owner, for an
 * outside account from `user.organisationId` rather than trusting anything
 * on `clean`. A `CleanEnquiry` already passed through `cleanEnquiry`'s own
 * whitelist once, but that whitelist lives in intake.ts, not here, and this
 * function has no way to know it was reached honestly — same reasoning as
 * `eventScope` in scope.ts. Scope comes from the session or not at all.
 *
 * The event, its acts, its house task estimates and its first activity line
 * are one nested `create`, so an `Event` can never exist without them — there
 * is no half-built row a pipeline read could ever see.
 */

export interface IntakeOptions {
  spaces: IntakeSpace[]
  people: { id: string; name: string }[]
  organisations: { id: string; name: string }[]
}

export async function loadIntakeOptions(user: SessionUser): Promise<IntakeOptions> {
  const spaces = await db.space.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, capacity: true, seatedCapacity: true },
  })

  // Outside accounts pick nobody and nothing on file — not even the query.
  if (user.external) return { spaces, people: [], organisations: [] }

  const people = await db.person.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })
  const organisations = await db.payee.findMany({
    where: { kind: 'PROMOTER' },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })

  return { spaces, people, organisations }
}

export type Created =
  { ok: true; eventId: string; spaceName: string } | { ok: false; field: FieldKey; why: string }

const MODEL_DB: Record<CleanEnquiry['model'], BookingModel> = {
  curator: 'CURATOR',
  dry: 'DRY',
}

const ARTIST_STATUS_DB: Record<CleanEnquiry['acts'][number]['status'], ArtistStatus> = {
  enquired: 'ENQUIRED',
  pencilled: 'PENCILLED',
  confirmed: 'CONFIRMED',
}

export async function createEnquiry(user: SessionUser, clean: CleanEnquiry): Promise<Created> {
  const space = await db.space.findFirst({
    where: { id: clean.spaceId },
    select: { id: true, name: true },
  })
  if (!space) return { ok: false, field: 'spaceId', why: 'That room is not on the books.' }

  // Defence in depth: an outside account's organisation and owner come from
  // the session, never from `clean` — whatever `clean.bringing` says, and
  // however it came to say it.
  let bringing = clean.bringing
  let ownerId = clean.ownerId
  if (user.external) {
    const verdict = mayStartEnquiry(user)
    if (!verdict.ok) return { ok: false, field: 'organisationId', why: verdict.why }
    // `mayStartEnquiry` has just vouched for the organisation. An id that was
    // somehow still missing would find no payee below, and be refused there.
    bringing = { by: 'organisation', organisationId: user.organisationId ?? '' }
    ownerId = null
  }

  let promoter: string | null = null
  let promoterId: string | null = null
  let internal = false

  if (bringing.by === 'organisation') {
    const payee = await db.payee.findFirst({
      where: { id: bringing.organisationId, kind: 'PROMOTER' },
      select: { name: true },
    })
    if (!payee) {
      return { ok: false, field: 'organisationId', why: 'That organisation is not on file.' }
    }
    promoter = payee.name
    promoterId = bringing.organisationId
  } else if (bringing.by === 'name') {
    promoter = bringing.name
  } else {
    internal = true
  }

  let ownerName: string | null = null
  if (ownerId) {
    const owner = await db.person.findFirst({
      where: { id: ownerId, active: true },
      select: { id: true, name: true },
    })
    if (!owner) return { ok: false, field: 'ownerId', why: 'That person is not on the books.' }
    ownerName = owner.name
  }
  if (bringing.by === 'venue') promoter = internalContact(ownerName)

  const event = await db.event.create({
    data: {
      name: clean.name,
      date: clean.date,
      dateTbc: clean.dateTbc,
      spaceId: clean.spaceId,
      kind: clean.kind,
      format: clean.format,
      doors: clean.doors,
      barClose: clean.barClose,
      allOut: clean.allOut,
      ownerId,
      promoter,
      promoterId,
      internal,
      model: MODEL_DB[clean.model],
      split: clean.split,
      att: clean.att,
      barHead: clean.barHead,
      gear: clean.gear,
      adv: clean.adv,
      sound: clean.sound,
      crew: clean.crew,
      tok: clean.tok,
      brief: clean.brief,
      artists: {
        create: clean.acts.map((act, index) => ({
          name: act.name,
          status: ARTIST_STATUS_DB[act.status],
          low: act.low,
          high: act.high,
          order: index,
        })),
      },
      tasks: {
        create: HOUSE_TASKS.map((t) => ({ name: t.name, est: t.est })),
      },
      activity: {
        create: [
          {
            personId: user.personId,
            who: user.initials,
            text: startedLine({
              external: user.external,
              // The payee row's name, not the session's — an outside
              // account's own organisationName could be stale or absent.
              organisationName: bringing.by === 'organisation' ? promoter : null,
              spaceName: space.name,
              date: clean.date,
              dateTbc: clean.dateTbc,
              note: clean.note,
            }),
          },
        ],
      },
    },
    select: { id: true },
  })

  return { ok: true, eventId: event.id, spaceName: space.name }
}
