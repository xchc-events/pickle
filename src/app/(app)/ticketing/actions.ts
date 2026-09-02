'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import { mixProblem, normaliseMix } from '@/lib/ticketing'
import { said, type Said } from '@/lib/toast'

/**
 * Ticketing's mutations.
 *
 * Everything here changes a price, and a price changes the settlement. So
 * every one of them writes to the activity table with the old value as well
 * as the new: "who moved the standard price and what was it before" is the
 * question somebody asks a fortnight later, and a log that only records the
 * new figure cannot answer it.
 *
 * An external promoter reaching these is scoped out by `requireEvent`, which
 * 404s an event outside their org.
 */

const MAX_PRICE = 500

export async function setPrices(eventId: string, form: FormData): Promise<Said> {
  const { user } = await requireModule('ticketing')
  const id = await requireEvent(user, eventId)

  const std = Number(form.get('std'))
  const door = Number(form.get('door'))

  if (!Number.isFinite(std) || std < 0 || !Number.isFinite(door) || door < 0) {
    return said('A price has to be a number, and not a negative one.', 'stop')
  }
  if (std > MAX_PRICE || door > MAX_PRICE) {
    return said(
      `${MAX_PRICE} is the ceiling. Above that is a typo more often than a price.`,
      'stop',
    )
  }

  const before = await db.event.findUniqueOrThrow({
    where: { id },
    select: { std: true, door: true, name: true },
  })

  if (before.std === std && before.door === door) return said('Nothing changed.', 'warn')

  await db.event.update({ where: { id }, data: { std, door } })

  // Both figures, before and after. Every other tier derives from `std`, so
  // moving it moves three prices at once and the log should say so.
  await record(
    id,
    user,
    `ticket prices: standard $${before.std} → $${std}, door $${before.door} → $${door}`,
  )

  refresh()
  return said(
    `Standard is $${std}. Supporter and subsidised move with it — every tier derives from that one number.`,
  )
}

/**
 * Set the four-way mix.
 *
 * Refused rather than silently corrected when the shares do not make a whole.
 * Normalising somebody's 30/30/30/30 without telling them would change the
 * average ticket price from what they typed, and the average is what reaches
 * the P&L.
 */
export async function setMix(eventId: string, form: FormData): Promise<Said> {
  const { user } = await requireModule('ticketing')
  const id = await requireEvent(user, eventId)

  const mix = ['sub', 'std', 'sup', 'door'].map((k) => Number(form.get(k)) / 100)

  const problem = mixProblem(mix)
  if (problem) return said(problem, 'stop')

  const before = await db.event.findUniqueOrThrow({ where: { id }, select: { mix: true } })
  const next = normaliseMix(mix)

  await db.event.update({ where: { id }, data: { mix: next } })
  await record(
    id,
    user,
    `ticket mix: ${before.mix.map((n) => Math.round(n * 100)).join('/')} → ${next
      .map((n) => Math.round(n * 100))
      .join('/')}`,
  )

  refresh()
  return said('Mix updated. The average ticket price moved with it, and so did the projection.')
}

/** Which attendance scenario the projection reads. */
export async function setScenario(eventId: string, scen: number): Promise<Said> {
  const { user } = await requireModule('ticketing')
  const id = await requireEvent(user, eventId)

  if (![0, 1, 2].includes(scen)) return said('That is not one of the scenarios.', 'stop')

  const labels = ['quiet', 'likely', 'great']
  await db.event.update({ where: { id }, data: { scen } })
  await record(id, user, `projection now reads the ${labels[scen]} case`)

  refresh()
  return said(
    `Projection reads the ${labels[scen]} case. Every figure in Finance moves with it — it is the same number.`,
  )
}

/**
 * Record how many have sold.
 *
 * Typed in for now. Gather.rsvp is the source of truth for this and once it
 * is connected this becomes a read rather than a write — which is why the
 * activity line says who typed it, so a figure that disagrees with Gather
 * later has a name against it.
 */
export async function setSold(eventId: string, form: FormData): Promise<Said> {
  const { user } = await requireModule('ticketing')
  const id = await requireEvent(user, eventId)

  const sold = Number(form.get('sold'))
  if (!Number.isInteger(sold) || sold < 0) {
    return said('Tickets sold has to be a whole number, and not a negative one.', 'stop')
  }

  const before = await db.event.findUniqueOrThrow({ where: { id }, select: { sold: true } })
  if (before.sold === sold) return said('Nothing changed.', 'warn')

  await db.event.update({ where: { id }, data: { sold } })
  await record(id, user, `tickets sold: ${before.sold} → ${sold}, entered by hand`)

  refresh()
  return said(
    `${sold} sold. Entered by hand — when Gather.rsvp is connected this reads itself and stops being somebody's typing.`,
    'warn',
  )
}
