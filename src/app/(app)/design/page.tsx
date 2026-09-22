import Link from 'next/link'
import { requireModule } from '@/lib/permissions'
import { loadDesign } from '@/lib/design-data'
import { isConfigured } from '@/lib/r2'
import type { AssetCard } from '@/lib/design'
import { SectionHeading } from '@/components/SectionHeading'
import { Avatar } from '@/components/Avatar'
import { ActionButton } from '@/components/ActionButton'
import { LeadPicker } from '@/components/LeadPicker'
import { FileUpload } from '@/components/FileUpload'
import { OpenArtwork } from './OpenArtwork'
import {
  approveAsset,
  beginArtworkUpload,
  finishArtworkUpload,
  linkToArtwork,
  requestChange,
  setDesignLead,
} from './actions'
import styles from './design.module.css'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** The three tiers, and why the house ranks them this way. */
const TIERS = [
  {
    key: 'hero' as const,
    step: '1 · do these first',
    note: 'Two vertical cuts. Nothing else in the set reaches anyone new.',
  },
  {
    key: 'lead' as const,
    step: '2 · the one still that matters',
    note: 'Event page, share card and every listing thumbnail come off this.',
  },
  {
    key: 'support' as const,
    step: '3 · everything else',
    note: 'Mostly re-cuts of the above. Do not make new work here.',
  },
]

export default async function DesignPage({ searchParams }: PageProps<'/design'>) {
  // Server-side gate. A role without design gets a 404 here, not a hidden
  // link — the sidebar is only the convenience.
  const { user } = await requireModule('design')

  const sp = await searchParams
  const { queue, event, leadOptions, rules, storageReady } = await loadDesign(
    user,
    one(sp.event),
    isConfigured(),
  )

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Design &amp; communications</h1>
          <p className={styles.sub}>
            briefs written once, in the event record · nothing here arrived by email
          </p>
        </div>
      </header>

      {!storageReady ? (
        <p className={styles.notReady}>
          <i className="ph ph-warning" aria-hidden="true" />
          File storage is not configured on this install, so nothing can be uploaded yet. Everything
          else on this page works. Set the R2 keys in <code>.env</code> — see the README.
        </p>
      ) : null}

      <div className={styles.queue}>
        {queue.map((q) => (
          <Link
            key={q.id}
            href={`/design?event=${q.id}`}
            className={`${styles.queueItem} ${event?.id === q.id ? styles.queueOn : ''}`}
          >
            <span className={styles.queueName}>{q.name}</span>
            <span className={`${styles.queueNote} ${styles[q.noteTone]}`}>{q.note}</span>
            <span className={`${styles.queueLead} ${styles[q.leadTone]}`}>
              <i className="ph ph-palette" aria-hidden="true" />
              {q.lead}
            </span>
          </Link>
        ))}
      </div>

      {event === null ? (
        <p className={styles.empty}>
          Nothing is past Confirmed. Design starts when terms do — briefing an event that has not
          been agreed is how work gets done on events that never happen.
        </p>
      ) : (
        <div className={styles.body}>
          <div className={styles.briefRow}>
            <div className={styles.briefMain}>
              <div className={styles.leadCard}>
                <div className={styles.leadLabel}>Design lead</div>
                <div className={styles.leadRow}>
                  <Avatar
                    initials={event.leadInitials ?? '?'}
                    title={event.leadName ?? 'Unassigned'}
                    accent={event.leadInitials !== null}
                  />
                  <LeadPicker
                    label="Design lead"
                    value={event.leadPersonId ?? ''}
                    options={leadOptions}
                    action={setDesignLead.bind(null, event.id)}
                  />
                </div>
                <p className={`${styles.leadNote} ${event.leadName ? '' : styles.warn}`}>
                  {event.leadName
                    ? `${event.leadName} owns every asset on this event — sign-offs, re-cuts and the hours below all land on them.`
                    : 'Nobody leads design on this event. Its design cannot be signed off until someone does.'}
                </p>
                {event.leadEmail || event.leadPhone ? (
                  <p className={styles.leadContact}>
                    {event.leadEmail ? <span>{event.leadEmail}</span> : null}
                    {event.leadPhone ? <span>{event.leadPhone}</span> : null}
                  </p>
                ) : null}
              </div>

              <SectionHeading>The brief</SectionHeading>

              {event.missingBios.length ? (
                <ul className={styles.chase}>
                  {event.missingBios.map((m) => (
                    <li key={m.name} className={styles.chaseItem}>
                      <span className={styles.chaseName}>{m.name}</span>
                      <span className={styles.chaseWhat}>missing {m.missing}</span>
                      {m.chaseNote ? <span className={styles.chaseNote}>{m.chaseNote}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className={styles.brief}>
                <div className={styles.briefHead}>
                  <span className={styles.live}>
                    <i className="ph ph-seal-check" aria-hidden="true" />
                    Live from the event record
                  </span>
                  <span className={styles.briefHint}>
                    If the coordinator moves doors, this changes.
                  </span>
                </div>

                <div className={styles.briefBody}>
                  <div>
                    <div className={styles.fieldLabel}>The one-liner</div>
                    <div className={styles.oneLiner}>{event.brief.line}</div>
                  </div>

                  <div>
                    <div className={styles.fieldLabel}>Tone</div>
                    <div className={styles.tones}>
                      {event.brief.tone.map((t) => (
                        <span key={t} className="tag tag-neutral">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className={styles.pair}>
                    <div>
                      <div className={styles.fieldLabel}>Date</div>
                      <div className={`${styles.fieldValue} tabular`}>{event.dateLabel}</div>
                    </div>
                    <div>
                      <div className={styles.fieldLabel}>From</div>
                      <div className={`${styles.fieldValue} tabular`}>{event.brief.from}</div>
                    </div>
                  </div>

                  <div>
                    <div className={styles.fieldLabel}>Must appear</div>
                    <div className={styles.must}>
                      {event.brief.mustAppear.map((m) => (
                        <span key={m}>
                          <i className="ph ph-check" aria-hidden="true" />
                          {m}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <aside className={styles.hoursCard}>
              <div className={styles.leadLabel}>Hours on this label</div>
              <div
                className={`${styles.hoursFigure} ${event.hours.over ? styles.warn : ''} tabular`}
              >
                {event.hours.text}
              </div>
              <div className={styles.track}>
                <div
                  className={`${styles.fill} ${event.hours.over ? styles.fillWarn : ''}`}
                  style={{ width: `${event.hours.pct}%` }}
                />
              </div>
              {event.hours.by.length ? (
                <ul className={styles.hoursBy}>
                  {event.hours.by.map((b) => (
                    <li key={b.name} className={styles.hoursByRow}>
                      <span>{b.name}</span>
                      <span className="tabular">{b.hoursLabel}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.hoursNote}>
                  Nobody has logged marketing hours on this event yet.
                </p>
              )}
            </aside>
          </div>

          <SectionHeading note={event.approved}>The set — {event.name}</SectionHeading>

          {TIERS.map((t) => {
            const cards = event[t.key]
            return (
              <section key={t.key} className={styles.tier}>
                <div className={styles.step}>
                  <span className={styles.stepLabel}>{t.step}</span>
                  <span className={styles.stepNote}>{t.note}</span>
                  {t.key === 'hero' ? (
                    <>
                      <span className={styles.spacer} />
                      <span className={styles[event.verticals.tone]}>{event.verticals.text}</span>
                    </>
                  ) : null}
                </div>
                <div className={t.key === 'lead' ? styles.oneUp : styles.cards}>
                  {cards.map((a) => (
                    <AssetTile
                      key={a.key}
                      eventId={event.id}
                      asset={a}
                      storageReady={storageReady}
                    />
                  ))}
                </div>
              </section>
            )
          })}

          <SectionHeading note="house standard for every event">
            How this content earns its keep
          </SectionHeading>
          <div className={styles.rules}>
            {rules.map((r, i) => (
              <div key={r.title} className={styles.rule}>
                <div className={styles.ruleHead}>
                  <span className={`${styles.ruleNum} tabular`}>{i + 1}</span>
                  <span className={styles.ruleTitle}>{r.title}</span>
                </div>
                <p className={styles.ruleBody}>{r.body}</p>
              </div>
            ))}
          </div>

          <SectionHeading>Written once, cut to fit</SectionHeading>
          <div className={styles.copy}>
            <p className={styles.caption}>{event.caption}</p>
            <div className={styles.copyRows}>
              {event.copy.map((c) => (
                <div key={c.label} className={styles.copyRow}>
                  <div className={styles.copyLabel}>{c.label}</div>
                  <div className={`${styles.copyValue} ${styles[c.tone]} tabular`}>{c.value}</div>
                </div>
              ))}
            </div>
            <p className={styles.copyNote}>
              Approving the last piece moves the event to On sale on its own — try it.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function AssetTile({
  eventId,
  asset,
  storageReady,
}: {
  eventId: string
  asset: AssetCard
  storageReady: boolean
}) {
  return (
    <article className={`${styles.card} ${asset.state === 'review' ? styles.cardReview : ''}`}>
      <div className={`${styles.thumb} ${asset.state === 'review' ? styles.thumbReview : ''}`}>
        <i className={`ph ${asset.icon} ${styles.thumbIcon}`} aria-hidden="true" />
        <span className={styles.spec}>{asset.spec}</span>
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <span className={styles.assetName}>{asset.name}</span>
          <span className={`tag ${styles.chip} ${styles[`chip_${asset.tone}`]}`}>
            {asset.label}
          </span>
        </div>
        <p className={styles.why}>{asset.why}</p>

        {/* The file and the sign-off are separate on purpose: a piece is often
            approved off a proof in the room, and the finished artwork lands
            afterwards. Neither waits on the other. */}
        <div className={styles.artwork}>
          {asset.file ? (
            <div className={styles.artworkRow}>
              <OpenArtwork eventId={eventId} fileId={asset.file.id} link={linkToArtwork}>
                {asset.file.name}
              </OpenArtwork>
              {asset.file.version > 1 ? (
                <span className={styles.artworkVersion}>v{asset.file.version}</span>
              ) : null}
            </div>
          ) : null}

          {storageReady ? (
            <FileUpload
              label={asset.file ? 'Replace the file' : 'Add the file'}
              // Bound rather than wrapped in an arrow: a closure made in a
              // server component cannot cross into a client one, and only a
              // server action (or a bind of one) can be passed across.
              begin={beginArtworkUpload.bind(null, eventId, asset.key)}
              finish={finishArtworkUpload.bind(null, eventId)}
            />
          ) : null}
        </div>

        {asset.needsPromoterSignOff ? (
          <div className={`${styles.signOff} ${asset.promoterSigned ? styles.good : ''}`}>
            <i
              className={`ph ${asset.promoterSigned ? 'ph-seal-check' : 'ph-seal'}`}
              aria-hidden="true"
            />
            {asset.promoterSigned ? 'promoter signed off' : 'promoter has not signed off'}
          </div>
        ) : null}

        {/* Only the piece actually up for sign-off is actionable. Drafts are
            somebody's work in progress, not a decision waiting to be taken. */}
        {asset.state === 'approved' ? (
          <div className={`${styles.done} ${styles.good}`}>
            <i className="ph ph-check-circle" aria-hidden="true" />
            signed off
          </div>
        ) : asset.state === 'review' ? (
          <div className={styles.actions}>
            <ActionButton
              className={`btn btn-primary ${styles.act} ${styles.actWide}`}
              action={approveAsset.bind(null, eventId, asset.key)}
            >
              Approve
            </ActionButton>
            <ActionButton
              className={`btn btn-ghost ${styles.act}`}
              action={requestChange.bind(null, eventId, asset.key)}
            >
              Change
            </ActionButton>
          </div>
        ) : null}
      </div>
    </article>
  )
}
