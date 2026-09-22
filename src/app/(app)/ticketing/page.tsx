import Link from 'next/link'
import { requireModule } from '@/lib/permissions'
import { loadTicketing } from '@/lib/ticketing-data'
import { SectionHeading } from '@/components/SectionHeading'
import { TiersTable } from './Forms'
import { setTiers } from './actions'
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

          {/* Sold, breakeven and full-pay against one capacity. The markers
              are what make this a judgement rather than a number. */}
          <div className={styles.room}>
            <div className={styles.roomTrack}>
              <div className={styles.roomSold} style={{ width: `${event.sellThroughPct}%` }} />
              {event.projected > event.sold ? (
                <div
                  className={styles.roomProjected}
                  style={{
                    left: `${event.sellThroughPct}%`,
                    width: `${Math.max(0, event.projectedPct - event.sellThroughPct)}%`,
                  }}
                  title={`Projected ${event.projected}`}
                />
              ) : null}
              <div
                className={styles.marker}
                style={{ left: `${event.breakevenPct}%` }}
                title={`Breakeven at ${event.breakeven}`}
              />
              <div
                className={`${styles.marker} ${styles.markerFull}`}
                style={{ left: `${event.fullPayPct}%` }}
                title={`Everyone paid in full at ${event.fullPay}`}
              />
            </div>

            <div className={styles.roomLegend}>
              <span>
                <b className={styles.sold}>{event.sold}</b> sold · read from Gather.rsvp · as of{' '}
                {event.soldAsOf}
              </span>
              <span>
                <b>{event.breakeven}</b> to break even
              </span>
              <span>
                <b>{event.fullPay}</b> to pay everyone in full
              </span>
            </div>
            <p className={styles.soldNote}>
              Never typed by hand here — Gather.rsvp is the source of truth for how many have sold.
            </p>

            {/* Two different facts, so two sentences. The pace is about where
                sales look like landing; the shortfall is about today. Running
                them together reads as a contradiction — "clears breakeven with
                59 to spare, 2 more would cover it". */}
            <p className={`${styles.pace} ${styles[event.paceTone]}`}>{event.paceNote}</p>
            {event.toBreakeven > 0 ? (
              <p className={styles.paceToday}>
                Today it is {event.toBreakeven} short of the {event.breakeven} that covers costs.
              </p>
            ) : (
              <p className={styles.paceToday}>Breakeven is already covered by tickets sold.</p>
            )}
            <p className={styles.paceCaveat}>
              The projection is a flat assumption that sales so far are 56% of the eventual total —
              a rough read, not a model. It gets replaced by a real curve once Gather.rsvp is
              connected.
            </p>
          </div>

          <SectionHeading note={`average ${event.average}`}>Tiers and the mix</SectionHeading>

          <TiersTable
            std={event.std}
            door={event.door}
            mix={event.mix}
            save={setTiers.bind(null, event.id)}
          />
        </div>
      )}
    </div>
  )
}
