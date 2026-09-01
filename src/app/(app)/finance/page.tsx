import Link from 'next/link'
import { requireModule, modulesFor } from '@/lib/permissions'
import { loadFinance } from '@/lib/finance-data'
import { canReveal } from '@/lib/payments'
import { STAGES } from '@/lib/constants'
import { money } from '@/lib/format'
import { SectionHeading } from '@/components/SectionHeading'
import { ActionButton } from '@/components/ActionButton'
import { Reveal } from './Reveal'
import { PayeeActions } from './PayeeActions'
import { chaseDetails, forget, markPaid, reveal, revokeAllLinks } from './actions'
import styles from './finance.module.css'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * Finance — the paying-people half.
 *
 * Organised by event because that is how settling works, and because
 * `revealFor` requires an event: reading somebody's account number has to have
 * a reason, and the show being settled is the reason. A page listing payees on
 * their own would make it possible to read details with no reason at all.
 *
 * Everything on this page is drawn from the tails kept in the clear. Nothing
 * is decrypted until somebody presses Reveal, and pressing it writes a row to
 * the event's activity naming them.
 */
export default async function FinancePage({ searchParams }: PageProps<'/finance'>) {
  const { user } = await requireModule('finance')
  const modules = await modulesFor(user)

  // The same verdict the action will reach, computed here so the interface can
  // explain itself rather than presenting a button that always refuses.
  const verdict = canReveal({
    roleKey: user.roleKey,
    modules,
    external: user.external,
    authenticated: user.authenticated,
    production: process.env.NODE_ENV === 'production',
  })

  const sp = await searchParams
  const { queue, event, sealedReason } = await loadFinance(user, one(sp.event), {
    allowed: verdict.ok,
    why: verdict.ok ? null : verdict.why,
  })

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Finance</h1>
          <p className={styles.sub}>
            <span className={styles.kicker}>the Till</span> · who gets paid, and where it goes ·
            every look at an account is on the record
          </p>
        </div>
      </header>

      {sealedReason ? (
        <p className={styles.sealedBanner}>
          <i className="ph ph-lock-simple" aria-hidden="true" />
          {sealedReason}
        </p>
      ) : null}

      <div className={styles.queue}>
        {queue.map((q) => (
          <Link
            key={q.id}
            href={`/finance?event=${q.id}`}
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
          Nothing to settle. Events appear here once terms are agreed and stay until they have been
          paid for — which is after everyone else has stopped looking at them.
        </p>
      ) : (
        <div className={styles.body}>
          <div className={styles.eventHead}>
            <h2 className={styles.eventName}>{event.name}</h2>
            <span className={styles.eventMeta}>
              {event.date} · {STAGES[event.stage] ?? '—'}
            </span>
          </div>

          <SectionHeading note="details are entered by the act, never re-typed here">
            Who gets paid
          </SectionHeading>

          {event.payables.length === 0 ? (
            <p className={styles.none}>Nobody is attached to this event yet.</p>
          ) : (
            <ul className={styles.rows}>
              {event.payables.map((p) => (
                <li key={p.id} className={styles.row}>
                  <div className={styles.who}>
                    <span className={styles.whoName}>{p.name}</span>
                    <span className={styles.whoKind}>
                      {p.kind === 'promoter' ? 'promoter' : 'act'}
                      {p.country !== 'NZ' ? ` · ${p.country}` : ''}
                    </span>
                  </div>

                  <div className={styles.account}>
                    <span className={p.onFile ? styles.mono : styles.warn}>
                      {p.onFile ? p.account : 'nothing on file'}
                    </span>
                    {p.confirmedAt ? (
                      <span className={styles.accountNote}>they confirmed {p.confirmedAt}</span>
                    ) : p.onFile ? (
                      <span className={styles.accountNote}>never confirmed by them</span>
                    ) : null}
                  </div>

                  <div className={styles.fee}>
                    {p.fee > 0 ? <span className="tabular">{money(p.fee)}</span> : null}
                    {p.withholding > 0 ? (
                      <span className={styles.withheld}>
                        less {Math.round(p.withholding * 100)}% withheld
                      </span>
                    ) : null}
                  </div>

                  {p.payeeId && p.onFile ? (
                    <Reveal
                      name={p.name}
                      sealed={sealedReason}
                      reveal={reveal.bind(null, event.id, p.payeeId)}
                    />
                  ) : (
                    <span className={styles.noReveal}>—</span>
                  )}

                  {p.payeeId ? (
                    <PayeeActions
                      name={p.name}
                      onFile={p.onFile}
                      openGrant={p.openGrant}
                      chase={chaseDetails.bind(null, event.id, p.payeeId)}
                      revoke={revokeAllLinks.bind(null, event.id, p.payeeId)}
                      forget={forget.bind(null, event.id, p.payeeId)}
                    />
                  ) : (
                    <span className={styles.noReveal}>no record yet</span>
                  )}

                  {p.kind === 'artist' ? (
                    <ActionButton
                      className={`${styles.paid} ${p.paid ? styles.paidOn : ''}`}
                      action={markPaid.bind(null, event.id, p.id)}
                      title={p.paid ? 'Mark unpaid' : 'Mark paid'}
                    >
                      <i
                        className={`ph ${p.paid ? 'ph-check-circle' : 'ph-circle'}`}
                        aria-hidden="true"
                      />
                      {p.paid ? 'paid' : 'unpaid'}
                    </ActionButton>
                  ) : (
                    <span className={styles.noReveal} />
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className={styles.footnote}>
            Marking somebody paid is a separate act from looking up their account — knowing the
            number is not the same as having sent the money, and a product that treated them as one
            would quietly mark people paid who were not.
          </p>
        </div>
      )}
    </div>
  )
}
