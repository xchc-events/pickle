import Link from 'next/link'
import { requireModule } from '@/lib/permissions'
import { loadPromo } from '@/lib/promo-data'
import { COPY_LIMITS } from '@/lib/design'
import { SectionHeading } from '@/components/SectionHeading'
import { ActionButton } from '@/components/ActionButton'
import { CopyButton } from '@/components/CopyButton'
import { pushChannel, pushStale, toggleBeat, unpushChannel } from './actions'
import styles from './promo.module.css'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** Where a channel cuts the caption off, if the house knows. */
const limitFor = (name: string) => COPY_LIMITS.find((c) => c.label === name)?.limit ?? undefined

export default async function PromoPage({ searchParams }: PageProps<'/promo'>) {
  // Server-side gate. A role without promo gets a 404 here, not a hidden link.
  const { user } = await requireModule('promo')

  const sp = await searchParams
  const { queue, event, rules } = await loadPromo(user, one(sp.event))

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Promotion</h1>
          <p className={styles.sub}>
            Ten channels off one record · what pushes itself, what needs a human, and who did it
          </p>
        </div>
        {event ? (
          <ActionButton
            className={`btn btn-primary ${styles.sync}`}
            action={pushStale.bind(null, event.id)}
          >
            <i className="ph ph-upload-simple" aria-hidden="true" />
            Bring everything in sync
          </ActionButton>
        ) : null}
      </header>

      <div className={styles.queue}>
        {queue.map((q) => (
          <Link
            key={q.id}
            href={`/promo?event=${q.id}`}
            className={`${styles.queueItem} ${event?.id === q.id ? styles.queueOn : ''}`}
          >
            <span className={styles.queueName}>{q.name}</span>
            <span className={`${styles.queueDate} tabular`}>{q.dateLabel}</span>
            <span className={`${styles.queueNote} ${styles[q.noteTone]}`}>{q.note}</span>
          </Link>
        ))}
      </div>

      {event === null ? (
        <p className={styles.empty}>
          Nothing is on the way. An event picks up its channels once it is being negotiated, and
          drops off here once it has been settled.
        </p>
      ) : (
        <div className={styles.body}>
          <div className={styles.main}>
            <div className={styles.channelHead}>
              <h2 className={styles.eventName}>{event.name}</h2>
              <span className={styles.eventMeta}>
                {event.dateLabel} · {event.doorLine} · {event.summary.outLine} channels out
              </span>
              <div className="rule-fade" />
              <span className={styles[event.summary.headlineTone]}>{event.summary.headline}</span>
            </div>

            <p className={styles.blurb}>
              Title, times, cover, price and the ticket link come off the event record. Change the
              bar close or the ticket price and everything auto-sync goes out again on its own; the
              two that have no usable API get flagged for a human, with a name and a time against
              them so nobody has to ask.
            </p>

            <div className={styles.channels}>
              {event.channels.map((c) => (
                <article
                  key={c.key}
                  className={`${styles.channel} ${c.state === 'out of date' ? styles.channelStale : ''} ${
                    c.state === 'not out' ? styles.channelOut : ''
                  }`}
                >
                  <div className={styles.channelTop}>
                    <i className={`ph ${c.icon} ${styles.channelIcon}`} aria-hidden="true" />
                    <span className={styles.channelName}>{c.name}</span>
                    <span
                      className={`${styles.kind} ${c.kind === 'manual' ? styles.kindManual : styles.kindApi}`}
                    >
                      {c.kindLabel}
                    </span>
                  </div>

                  <p className={styles.channelBlurb}>{c.blurb}</p>

                  <div className={styles.state}>
                    <span className={styles[c.tone]}>{c.state}</span>
                    {c.note ? <span className={styles.stateNote}>{c.note}</span> : null}
                  </div>

                  {c.by ? <div className={styles.by}>ticked off by {c.by}</div> : null}

                  <div className={styles.actions}>
                    <ActionButton
                      className={`btn ${c.actionPrimary ? 'btn-primary' : 'btn-ghost'} ${styles.act}`}
                      action={pushChannel.bind(null, event.id, c.key)}
                    >
                      {c.actionLabel}
                    </ActionButton>

                    {c.showCaption ? (
                      <CopyButton
                        className={`btn btn-ghost ${styles.act}`}
                        text={event.caption}
                        limit={limitFor(c.name)}
                        message={`Caption copied — the listing copy from Design, cut to ${c.name}’s limit.`}
                      >
                        <i className="ph ph-copy" aria-hidden="true" />
                        Caption
                      </CopyButton>
                    ) : null}

                    <span className={styles.spacer} />

                    {c.canUndo ? (
                      <ActionButton
                        className={styles.undo}
                        action={unpushChannel.bind(null, event.id, c.key)}
                      >
                        Not out yet
                      </ActionButton>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </div>

          <aside className={styles.aside}>
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <span className={styles.panelTitle}>The promo plan</span>
                <span className={styles.panelNote}>{event.beatsWorked}</span>
              </div>
              {event.beats.map((b) => (
                <ActionButton
                  key={b.key}
                  className={`${styles.beat} ${b.done ? styles.beatDone : ''}`}
                  action={toggleBeat.bind(null, event.id, b.key)}
                >
                  <i
                    className={`ph ${b.done ? 'ph-check-circle' : 'ph-circle-dashed'} ${styles.beatTick} ${
                      b.done ? styles.good : styles.plain
                    }`}
                    aria-hidden="true"
                  />
                  <span className={styles.beatBody}>
                    <span className={styles.beatTop}>
                      <span className={styles.beatName}>{b.name}</span>
                      <span className={styles.beatWhen}>{b.when}</span>
                    </span>
                    <span className={styles.beatChannels}>{b.channels}</span>
                  </span>
                </ActionButton>
              ))}
              <p className={styles.panelFoot}>
                The first two beats are a stage gate — the event will not move off On sale until
                they are worked.
              </p>
            </section>

            <section className={styles.panel}>
              <SectionHeading>Promo lead</SectionHeading>
              <div className={`${styles.lead} ${event.leadName ? '' : styles.warn}`}>
                {event.leadName ?? 'no promo lead'}
              </div>
              <p className={styles.panelFoot}>
                Set on the event record alongside the ticketing, design and tech leads. Manual
                pushes are logged against whoever ticks them off, not against the lead.
              </p>
            </section>

            <section className={styles.panel}>
              <SectionHeading>Before you post</SectionHeading>
              {rules.map((r) => (
                <div key={r.title} className={styles.rule}>
                  <div className={styles.ruleTitle}>{r.title}</div>
                  <div className={styles.ruleBody}>{r.body}</div>
                </div>
              ))}
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}
