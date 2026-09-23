'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import { validateDoorListEntry } from '@/lib/door-list'
import { said, type Said } from '@/lib/toast'
import type { DoorListEntryKind } from '@/generated/prisma/client'

/**
 * The door list's mutations — T7, 23 Sep 2026.
 *
 * Venue only, the same refusal as Codes: this is an operational list for
 * the venue's own door, not something an external promoter edits or needs
 * to see. Every change is an activity line — the comps line reads this list
 * (`compsCountFor` in src/lib/door-list.ts), so what changed here and when
 * is the same kind of question a price change already answers.
 */

export async function addDoorListEntry(eventId: string, form: FormData): Promise<Said> {
  const { user } = await requireModule('ticketing')
  const id = await requireEvent(user, eventId)
  if (user.external) return said('Not something an external account can do.', 'stop')

  const name = String(form.get('name') ?? '').trim()
  const partySize = Number(form.get('partySize'))
  const kind = String(form.get('kind') ?? 'GUEST') as DoorListEntryKind
  const note = String(form.get('note') ?? '').trim()

  const validated = validateDoorListEntry({ name, partySize, kind })
  if (!validated.ok) return said(validated.error, 'stop')

  await db.doorListEntry.create({
    data: {
      eventId: id,
      name,
      partySize,
      kind,
      note: note || null,
      addedById: user.id,
      who: user.name,
    },
  })

  await record(id, user, `door list: added ${name} (${kind.toLowerCase()}, ${partySize})`)

  refresh()
  return said(`${name} is on the door list.`)
}

export async function removeDoorListEntry(eventId: string, entryId: string): Promise<Said> {
  const { user } = await requireModule('ticketing')
  const id = await requireEvent(user, eventId)
  if (user.external) return said('Not something an external account can do.', 'stop')

  const entry = await db.doorListEntry.findFirst({ where: { id: entryId, eventId: id } })
  if (!entry) return said("That name is not on this event's door list.", 'stop')

  await db.doorListEntry.delete({ where: { id: entryId } })
  await record(
    id,
    user,
    `door list: removed ${entry.name} (${entry.kind.toLowerCase()}, ${entry.partySize})`,
  )

  refresh()
  return said(`${entry.name} is off the door list.`)
}
