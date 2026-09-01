import { requireModule } from '@/lib/permissions'
import { loadPortal } from '@/lib/portal-data'
import { STAGES } from '@/lib/constants'
import { SectionHeading } from '@/components/SectionHeading'
import { PaymentDetailsForm } from '@/components/PaymentDetailsForm'
import { saveOwnDetails } from './actions'
import styles from './portal.module.css'

/**
 * What an external promoter sees.
 *
 * They are inside the app — they have an account and a sidebar — but they are
 * not staff, and this page is scoped to the one organisation they belong to.
 * Everything shown here is either theirs or about their own shows; the
 * scoping happens in the query, not in this file.
 */
export default async function PortalPage() {
  const { user } = await requireModule('portal')
  const { payee, orgName, events } = await loadPortal(user)

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Sign-offs</h1>
          <p className={styles.sub}>
            <span className={styles.kicker}>{orgName ?? 'your organisation'}</span> · your shows at
            XCHC, and where the venue pays you
          </p>
        </div>
      </header>

      <div className={styles.body}>
        <SectionHeading note="the same account for every show you bring">
          Getting paid
        </SectionHeading>

        {payee === null ? (
          <p className={styles.none}>
            This account is not attached to a promoter organisation yet. Your coordinator at the
            venue can set that up.
          </p>
        ) : (
          <div className={styles.pay}>
            <div className={styles.payState}>
              <span className={styles.payLabel}>On file</span>
              <span className={payee.onFile ? styles.good : styles.warn}>{payee.account}</span>
              {payee.confirmedAt ? (
                <span className={styles.payNote}>
                  you confirmed these on {payee.confirmedAt.toDateString()}
                </span>
              ) : (
                <span className={styles.payNote}>
                  nothing on file — the venue cannot settle a show without this
                </span>
              )}
            </div>

            <PaymentDetailsForm
              save={saveOwnDetails}
              payeeName={payee.name}
              country={payee.country}
              onFile={payee.onFile}
              maskedAccount={payee.account}
            />
          </div>
        )}

        <SectionHeading note="everything your organisation has on">Your shows</SectionHeading>

        {events.length === 0 ? (
          <p className={styles.none}>Nothing on at the moment.</p>
        ) : (
          <ul className={styles.events}>
            {events.map((e) => (
              <li key={e.id} className={styles.event}>
                <div className={styles.eventMain}>
                  <span className={styles.eventName}>{e.name}</span>
                  <span className={styles.eventDate}>{e.date}</span>
                </div>
                <span className={styles.eventStage}>{STAGES[e.stage] ?? '—'}</span>
                <span className={e.awaitingSignOff ? styles.warn : styles.quiet}>
                  {e.awaitingSignOff
                    ? `${e.awaitingSignOff} waiting on you`
                    : 'nothing waiting on you'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
