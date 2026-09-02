import Link from 'next/link'
import { requireModule } from '@/lib/permissions'
import { loadTicketing } from '@/lib/ticketing-data'
import { SectionHeading } from '@/components/SectionHeading'
import { ActionButton } from '@/components/ActionButton'
import { PriceForm, MixForm, SoldForm } from './Forms'
import { setMix, setPrices, setScenario, setSold } from './actions'
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
            <span className={styles.kicker}>the Gate</span> · every tier derives from one number ·
            Gather.rsvp is the source of truth
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
          Nothing to price. Events appear here once terms are agreed — setting a ticket price for a
          show that has not been confirmed is pricing something that may not happen.
        </p>
      ) : (
        <div className={styles.body}>
          <div className={styles.eventHead}>
            <div>
              <h2 className={styles.eventName}>{event.name}</h2>
              <span className={styles.eventMeta}>
                {event.date} · {event.spaceName} · {event.format} · {event.stageLabel}
              </span>
            </div>
            <span className={event.onSale ? styles.live : styles.notLive}>
              <i
                className={`ph ${event.onSale ? 'ph-check-circle' : 'ph-clock'}`}
                aria-hidden="true"
              />
              {event.onSale ? 'live on Gather.rsvp' : 'not pushed to Gather yet'}
            </span>
          </div>

          <SectionHeading note={`${event.capacity} in the room`}>The room</SectionHeading>

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
                <b className={styles.sold}>{event.sold}</b> sold · {event.revenue}
              </span>
              <span>
                <b>{event.breakeven}</b> to break even
              </span>
              <span>
                <b>{event.fullPay}</b> to pay everyone in full
              </span>
            </div>

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

          {event.mixProblem ? (
            <p className={styles.mixWarn}>
              <i className="ph ph-warning" aria-hidden="true" />
              {event.mixProblem}
            </p>
          ) : null}

          <ul className={styles.tiers}>
            {event.tiers.map((t) => (
              <li key={t.key} className={styles.tier}>
                <span className={styles.tierLabel}>{t.label}</span>
                <span className={`${styles.tierPrice} tabular`}>{t.price}</span>
                <span className={styles.tierShare}>{t.share} of the room</span>
                <span className={`${styles.tierContributes} tabular`}>
                  {t.contributes} of the average
                </span>
              </li>
            ))}
          </ul>

          <div className={styles.forms}>
            <PriceForm std={event.std} door={event.door} save={setPrices.bind(null, event.id)} />
            <MixForm mix={event.mix} save={setMix.bind(null, event.id)} />
            <SoldForm sold={event.sold} save={setSold.bind(null, event.id)} />
          </div>

          <SectionHeading note="the projection reads whichever is on">
            How the night might go
          </SectionHeading>

          <ul className={styles.scenarios}>
            {event.scenarios.map((s) => (
              <li key={s.key} className={`${styles.scenario} ${s.on ? styles.scenarioOn : ''}`}>
                <div className={styles.scenarioMain}>
                  <span className={styles.scenarioLabel}>{s.label}</span>
                  <span className={styles.scenarioAtt}>{s.att} through the door</span>
                </div>
                <span className={`${styles.scenarioRevenue} tabular`}>{s.revenue}</span>
                {s.on ? (
                  <span className={styles.scenarioOnTag}>in use</span>
                ) : (
                  <ActionButton
                    className={styles.scenarioPick}
                    action={setScenario.bind(null, event.id, s.key)}
                    title={`Read the ${s.label.toLowerCase()} case`}
                  >
                    Use this
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>

          <p className={styles.footnote}>
            The scenario is not a Ticketing setting — Finance reads the same field, so switching it
            here moves the settlement projection there. That is the point: one record of an event.
          </p>
        </div>
      )}
    </div>
  )
}
