'use server'

import { refresh } from 'next/cache'
import { db } from '@/lib/db'
import { record } from '@/lib/activity'
import { requireEvent, requireModule } from '@/lib/permissions'
import { BEATS, isHttpUrl, platformSpec, stubPushUrl } from '@/lib/promo'
import { canGoOnSale, type BookingStatus } from '@/lib/parts'
import { budgetToLock } from '@/lib/bar-data'
import { nightFromBudget } from '@/lib/bar'
import { money } from '@/lib/format'
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
 *
 * Gather.rsvp is the exception to "any channel, any time". It is where
 * tickets are sold, and tickets do not go on sale until the booking is
 * confirmed — the one order between an event's parts that still refuses.
 * Every other listing may go out ahead of the booking; see src/lib/parts.ts.
 *
 * Its first push is also the moment the event goes on sale, which is when the
 * bar budget locks. That used to happen on the move to the On sale stage;
 * with the stages gone, it happens here, in the same transaction as the push.
 *
 * `url` is what a manual channel's tick-off form types in — optional, and
 * refused if it is not `http:`/`https:`. An auto-sync channel ignores it and
 * records what its client hands back instead; see `stubPushUrl`.
 */
export async function pushChannel(eventId: string, channel: string, url?: string): Promise<Said> {
  const { user } = await requireModule('promo')
  const id = await requireEvent(user, eventId)
  const spec = platformSpec(channel)
  if (!spec) return said('We do not post to that.', 'stop')

  const manual = spec.kind === 'manual'
  const typedUrl = url?.trim() ?? ''
  if (manual && typedUrl && !isHttpUrl(typedUrl)) {
    return said(
      'That does not look like a link. Paste the http:// or https:// address of what you posted, or leave it blank.',
      'stop',
    )
  }

  const tickets =
    channel === 'gather'
      ? await db.event.findUniqueOrThrow({
          where: { id },
          select: { bookingStatus: true, barBudget: { select: { id: true } } },
        })
      : null
  if (tickets) {
    const sale = canGoOnSale({ booking: tickets.bookingStatus.toLowerCase() as BookingStatus })
    if (!sale.ok) {
      return said(`Nothing went live. ${sale.why} — confirm it on the event record first.`, 'stop')
    }
  }

  const existing = await db.channelPush.findUnique({
    where: { eventId_channel: { eventId: id, channel } },
  })
  const first = !existing?.live
  const data = {
    live: true,
    stale: false,
    note: first ? 'created just now' : 'updated just now',
    byId: manual ? user.personId : null,
    at: new Date(),
    // A manual channel keeps its last link when the form is left blank rather
    // than losing it — retyping the same address on every re-post is the
    // kind of thing nobody does, and then nobody has it.
    url: manual ? typedUrl || (existing?.url ?? null) : stubPushUrl(channel, id),
  }

  const push = db.channelPush.upsert({
    where: { eventId_channel: { eventId: id, channel } },
    create: { eventId: id, channel, ...data },
    update: data,
  })

  // Tickets going on sale for the first time lock the bar budget, frozen at
  // what was believed then — unless one exists already, from an earlier
  // listing that was taken down. `update: {}` leaves a budget exactly as it
  // was even if two pushes land at once: a budget is never rewritten. See
  // src/lib/bar.ts.
  const budget = tickets && first && !tickets.barBudget ? await budgetToLock(id) : null
  if (budget) {
    await db.$transaction([
      push,
      db.barBudget.upsert({
        where: { eventId: id },
        create: { eventId: id, ...budget, basis: 'ON_SALE', lockedBy: user.initials },
        update: {},
      }),
    ])
  } else {
    await push
  }

  await record(
    id,
    user,
    manual
      ? `marked ${spec.name} posted by hand`
      : `${first ? 'listed on' : 'pushed changes to'} ${spec.name}`,
  )

  if (budget) {
    const night = nightFromBudget(budget)
    await record(
      id,
      user,
      `locked the bar budget — ${budget.heads} heads at ${money(budget.spendPerHead)}, ${money(night.take)} over the bar, ${money(night.margin)} after stock`,
    )
    refresh()
    return said(
      `Tickets are on sale on ${spec.name}, and the bar budget is locked at ${money(night.margin)} after stock. The bar is measured against that from here.`,
    )
  }

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
    update: { live: false, stale: false, note: null, byId: null, at: null, url: null },
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

  // Each channel gets its own stub URL back, so `updateMany` (one data
  // object for every row) will not do here.
  await db.$transaction(
    auto.map((c) =>
      db.channelPush.update({
        where: { id: c.id },
        data: { stale: false, note: 'updated just now', at: new Date(), url: stubPushUrl(c.channel, id) },
      }),
    ),
  )
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
