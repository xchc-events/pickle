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

/**
 * Set the standard and door prices and the four-way mix together.
 *
 * One Save for what used to be two forms (`setPrices` and `setMix`), because
 * the tiers table is now the thing that shows both — "if I change these
 * numbers, that is going to change this data" only reads as one idea when
 * saving it is one action too. The checks are exactly the two old actions':
 * a price has to be a non-negative number under the $500 ceiling, and a mix
 * that does not make a whole is refused, not silently corrected — normalising
 * somebody's 30/30/30/30 without telling them would change the average ticket
 * price from what they typed, and the average is what reaches the P&L.
 */
export async function setTiers(eventId: string, form: FormData): Promise<Said> {
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

  const mix = ['subShare', 'stdShare', 'supShare', 'doorShare'].map(
    (k) => Number(form.get(k)) / 100,
  )
  const problem = mixProblem(mix)
  if (problem) return said(problem, 'stop')

  const before = await db.event.findUniqueOrThrow({
    where: { id },
    select: { std: true, door: true, mix: true, name: true },
  })

  const next = normaliseMix(mix)
  const priceChanged = before.std !== std || before.door !== door
  const mixChanged = before.mix.some((n, i) => Math.abs(n - next[i]) > 1e-9)

  if (!priceChanged && !mixChanged) return said('Nothing changed.', 'warn')

  await db.event.update({ where: { id }, data: { std, door, mix: next } })

  // Both figures, before and after, and as two lines when both changed —
  // a price move and a mix move are two different decisions.
  if (priceChanged) {
    await record(
      id,
      user,
      `ticket prices: standard $${before.std} → $${std}, door $${before.door} → $${door}`,
    )
  }
  if (mixChanged) {
    await record(
      id,
      user,
      `ticket mix: ${before.mix.map((n) => Math.round(n * 100)).join('/')} → ${next
        .map((n) => Math.round(n * 100))
        .join('/')}`,
    )
  }

  refresh()
  return said('Prices and mix updated. The average ticket price and the projection moved with them.')
}
