'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import { BEATS, platformSpec } from '@/lib/promo'
import { said, type Said } from '@/lib/toast'

/**
 * Promotion's mutations.
 *
 * Each one re-checks the module permission and the event scope for itself —
 * an action is a POST endpoint, and the page that rendered the button is not
 * a security boundary. See src/lib/permissions.ts.
 */

/**
 * Put a channel out, or push the record at it again.
 *
 * A manual channel records *who* ticked it off. That is the whole point of
 * the distinction: an auto-sync channel is answerable to the record, and a
 * manual one is answerable to a person.
 */
export async function pushChannel(eventId: string, channel: string): Promise<Said> {
  const { user } = await requireModule('promo')
  const id = await requireEvent(user, eventId)
  const spec = platformSpec(channel)
  if (!spec) return said('We do not post to that.', 'stop')

  const existing = await db.channelPush.findUnique({
    where: { eventId_channel: { eventId: id, channel } },
  })
  const first = !existing?.live
  const manual = spec.kind === 'manual'
  const data = {
    live: true,
    stale: false,
    note: first ? 'created just now' : 'updated just now',
    byId: manual ? user.personId : null,
    at: new Date(),
  }

  await db.channelPush.upsert({
    where: { eventId_channel: { eventId: id, channel } },
    create: { eventId: id, channel, ...data },
    update: data,
  })

  await record(
    id,
    user,
    manual
      ? `marked ${spec.name} posted by hand`
      : `${first ? 'listed on' : 'pushed changes to'} ${spec.name}`,
  )

  refresh()
  return said(
    manual
      ? `${spec.name} ticked off. Whoever asks whether it went out can see who did it and when.`
      : `${spec.name} in sync. Title, times, cover, price and the ticket link all pushed from this one record.`,
  )
}

/** Take a channel back to not-out. The push is undone, not hidden. */
export async function unpushChannel(eventId: string, channel: string): Promise<Said> {
  const { user } = await requireModule('promo')
  const id = await requireEvent(user, eventId)
  const spec = platformSpec(channel)
  if (!spec) return said('We do not post to that.', 'stop')

  await db.channelPush.upsert({
    where: { eventId_channel: { eventId: id, channel } },
    create: { eventId: id, channel, live: false },
    update: { live: false, stale: false, note: null, byId: null, at: null },
  })
  await record(id, user, `marked ${spec.name} not out yet`)

  refresh()
  return said(`${spec.name} marked not out yet.`, 'warn')
}

/**
 * Bring every out-of-date listing back to what the record says.
 *
 * Only the channels that sync themselves are re-pushed. A listing somebody
 * posted by hand still needs that person, and saying otherwise would put a
 * tick against a post nobody made.
 */
export async function pushStale(eventId: string): Promise<Said> {
  const { user } = await requireModule('promo')
  const id = await requireEvent(user, eventId)

  const stale = await db.channelPush.findMany({ where: { eventId: id, stale: true } })
  if (stale.length === 0) return said('Nothing is out of date. Every channel matches the record.')

  const auto = stale.filter((c) => platformSpec(c.channel)?.kind === 'api')
  const byHand = stale.length - auto.length

  if (auto.length === 0) {
    return said(
      `Nothing here syncs itself. ${byHand} listing${byHand === 1 ? '' : 's'} need a human — ${byHand === 1 ? 'it is' : 'they are'} flagged below.`,
      'warn',
    )
  }

  await db.channelPush.updateMany({
    where: { id: { in: auto.map((c) => c.id) } },
    data: { stale: false, note: 'updated just now', at: new Date() },
  })
  await record(
    id,
    user,
    `brought ${auto.length} listing${auto.length === 1 ? '' : 's'} back in sync`,
  )

  refresh()
  return said(
    `${auto.length} listing${auto.length === 1 ? '' : 's'} updated from the record.` +
      (byHand ? ` ${byHand} still need${byHand === 1 ? 's' : ''} a human — flagged below.` : ''),
  )
}

/** Work a beat of the promo plan, or reopen it. */
export async function toggleBeat(eventId: string, key: string): Promise<Said> {
  const { user } = await requireModule('promo')
  const id = await requireEvent(user, eventId)
  const beat = BEATS.find((b) => b.key === key)
  if (!beat) return said('That is not a beat of the plan.', 'stop')

  const existing = await db.beat.findUnique({ where: { eventId_key: { eventId: id, key } } })
  const done = !existing?.done

  await db.beat.upsert({
    where: { eventId_key: { eventId: id, key } },
    create: { eventId: id, key, done },
    update: { done },
  })

  if (done) await record(id, user, `worked the ${beat.name.toLowerCase()} beat`)
  else await record(id, user, `reopened the ${beat.name.toLowerCase()} beat`)

  refresh()
  return done
    ? said(`${beat.name} done across its ${beat.channels.length} channels.`)
    : said(`${beat.name} reopened.`, 'warn')
}
