import Link from 'next/link'
import { requireModule } from '@/lib/permissions'
import { loadTicketing } from '@/lib/ticketing-data'
import { SectionHeading } from '@/components/SectionHeading'
import { TiersTable } from './Forms'
import { SalesChart } from './SalesChart'
import { Codes } from './Codes'
import { DoorList } from './DoorList'
import { setTiers } from './actions'
import { addCode, deactivateCode } from './codes-actions'
import { addDoorListEntry, removeDoorListEntry } from './door-list-actions'
import styles from './ticketing.module.css'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * Ticketing.
 *
 * Every price on this page derives from one number, and every figure that
 * involves money is read from `finance.ts` rather than worked out here. The
 * room diagram is the point of the screen: sold, breakeven and full-pay drawn
 * against the same capacity, so "are we going to be alright" is a look rather
 * than a calculation.
 */
export default async function TicketingPage({ searchParams }: PageProps<'/ticketing'>) {
  const { user } = await requireModule('ticketing')

  const sp = await searchParams
  const { queue, event } = await loadTicketing(user, one(sp.event))

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Ticketing</h1>
          <p className={styles.sub}>
            every tier derives from one number · Gather.rsvp is the source of truth
          </p>
        </div>
      </header>

      <div className={styles.queue}>
        {queue.map((q) => (
          <Link
            key={q.id}
            href={`/ticketing?event=${q.id}`}
            className={`${styles.queueItem} ${event?.id === q.id ? styles.queueOn : ''}`}
          >
            <span className={styles.queueName}>{q.name}</span>
            <span className={styles.queueDate}>{q.date}</span>
            <span className={`${styles.queueNote} ${styles[q.tone]}`}>{q.note}</span>
          </Link>
        ))}
      </div>

      {event === null ? (
        <p className={styles.empty}>
          Nothing to price. Events appear here from the enquiry on — a price can be modelled while
          the terms are, but tickets do not go on sale until the booking is confirmed.
        </p>
      ) : (
        <div className={styles.body}>
          <div className={styles.eventHead}>
            <div>
              <h2 className={styles.eventName}>{event.name}</h2>
              <span className={styles.eventMeta}>
                {event.date} · {event.spaceName} · {event.format} · booking{' '}
                {event.bookingLabel.toLowerCase()}
              </span>
            </div>
            <span className={event.onSale ? styles.live : styles.notLive}>
              <i
                className={`ph ${event.onSale ? 'ph-check-circle' : 'ph-clock'}`}
                aria-hidden="true"
              />
              {event.onSale
                ? 'live on Gather.rsvp'
                : event.confirmed
                  ? 'not pushed to Gather yet'
                  : 'cannot go on sale until the booking is confirmed'}
            </span>
          </div>

          <SectionHeading note={`${event.capacity} in the room`}>Ticket sales</SectionHeading>

          {/* "A big, really obvious thing of the revenue that's been
              generated." The figure is `event.revenue` from ticketing-data,
              which is sold × the average ticket price — GST inclusive, same
              as the prices on the event record, not the ex-GST figure the
              settlement counts. */}
          <div className={styles.revenue}>
            <span className={styles.revenueFigure}>{event.revenue}</span>
            <span className={styles.revenueSold}>
              {event.sold} sold of {event.capacity}
            </span>
            <p className={styles.revenueCaveat}>
              GST inclusive — the settlement counts revenue ex GST.
            </p>
          </div>

          {/* Cumulative sales over time, by tier: on by default, each
              toggleable from the legend, with the time scale, breakeven,
              full-pay and the projection to the door all on the graph
              itself. Never typed by hand — Gather.rsvp is the source of
              truth for how many have sold; `soldAsOf` is when it last said
              so. */}
          <SalesChart
            history={event.salesHistory}
            onSaleAt={event.onSaleAt}
            today={event.today}
            doorAt={event.doorAt}
            breakeven={event.breakeven}
            fullPay={event.fullPay}
            projectedTotal={event.projectedTotal}
            sold={event.sold}
          />
          <p className={styles.soldNote}>
            Read from Gather.rsvp, as of {event.soldAsOf} — never typed by hand here.
          </p>

          <SectionHeading note={`average ${event.average}`}>Tiers and the mix</SectionHeading>

          <TiersTable
            std={event.std}
            door={event.door}
            mix={event.mix}
            save={setTiers.bind(null, event.id)}
          />

          {/* Codes and the door list are the venue's own — an external
              promoter sees their tiers and sales above, but not these. */}
          {!user.external ? (
            <>
              <Codes
                codes={event.codes}
                add={addCode.bind(null, event.id)}
                deactivate={deactivateCode.bind(null, event.id)}
              />

              <DoorList
                eventId={event.id}
                doorList={event.doorList}
                add={addDoorListEntry.bind(null, event.id)}
                remove={removeDoorListEntry.bind(null, event.id)}
              />
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
