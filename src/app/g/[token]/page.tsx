import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { resolveGrant } from '@/lib/grants-data'
import { maskedPayee } from '@/lib/payments-data'
import { dateLabel } from '@/lib/format'
import { PaymentDetailsForm } from '@/components/PaymentDetailsForm'
import { GrantUploads } from './GrantUploads'
import { beginViaGrant, finishViaGrant, saveViaGrant } from './actions'
import styles from './grant.module.css'

/**
 * What a touring act sees.
 *
 * Deliberately outside the (app) route group: no sidebar, no session, no
 * navigation anywhere else. The person here has one thing to do and no
 * account, and every extra affordance is a way for them to get lost or to
 * find something that is not theirs.
 *
 * An invalid, expired or revoked link is a 404 — not "expired link", which
 * would confirm to somebody guessing that they had found a real one.
 */
export default async function GrantPage({ params }: PageProps<'/g/[token]'>) {
  const { token } = await params
  const grant = await resolveGrant(token)
  if (!grant) notFound()

  const payee = await maskedPayee(grant.payeeId)
  if (!payee) notFound()

  const wantsPayment = grant.scope === 'BOTH' || grant.scope === 'PAYMENT_DETAILS'
  const wantsFiles = grant.scope === 'BOTH' || grant.scope === 'RIDER'

  const held = await db.storedFile.findMany({
    where: { grantId: grant.id, current: true, scan: 'CLEAN' },
    select: { id: true, name: true, kind: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <header className={styles.head}>
          <span className={styles.venue}>XCHC · Ōtautahi Christchurch</span>
          <h1 className={styles.title}>{grant.payeeName}</h1>
          {grant.eventName ? (
            <p className={styles.event}>
              {grant.eventName}
              {grant.eventDate ? ` · ${dateLabel(grant.eventDate)}` : ''}
            </p>
          ) : null}
        </header>

        <p className={styles.intro}>
          {wantsPayment && wantsFiles
            ? 'Two things before the show: where to pay you, and what the tech crew needs. Both stay with the venue — neither is emailed anywhere.'
            : wantsPayment
              ? 'The venue needs to know where to pay you. This goes straight into the booking, not into anyone’s inbox.'
              : 'The tech crew needs your rider and stage plot. Whatever you upload here lands on the booking itself.'}
        </p>

        {wantsPayment ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Getting paid</h2>
            <PaymentDetailsForm
              save={saveViaGrant.bind(null, token)}
              payeeName={grant.payeeName}
              country={grant.payeeCountry}
              onFile={payee.onFile}
              maskedAccount={payee.account}
            />
          </section>
        ) : null}

        {wantsFiles ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>What the crew needs</h2>
            <GrantUploads
              begin={beginViaGrant.bind(null, token)}
              finish={finishViaGrant.bind(null, token)}
              held={held.map((h) => ({
                id: h.id,
                name: h.name,
                kind: h.kind,
                at: dateLabel(h.createdAt),
              }))}
            />
          </section>
        ) : null}

        <footer className={styles.foot}>
          This link is yours alone and stops working on {dateLabel(grant.expires)}. If you need it
          after that, ask the coordinator for a new one rather than forwarding this.
        </footer>
      </div>
    </div>
  )
}
