import Link from 'next/link'
import { requireModule } from '@/lib/permissions'
import { loadIntakeOptions } from '@/lib/intake-data'
import { mayStartEnquiry } from '@/lib/intake'
import { nightInput, venueToday } from '@/lib/night'
import { EnquiryForm } from './EnquiryForm'
import styles from './new.module.css'

/**
 * New enquiry — the one door into the pipeline.
 *
 * Staff and an outside account both reach this from Pipeline
 * (`requireModule('pipeline')` — both hold it). What differs is what each may
 * set, decided twice over: `EnquiryForm` leaves staff-only fields out of the
 * DOM entirely, and `cleanEnquiry` / `createEnquiry` rebuild an outside
 * account's event from a whitelist regardless of what the browser sends.
 *
 * A refusal — an outside account with no organisation to book under yet —
 * still gets the normal header and a plain explanation, not a 404: they can
 * already open Pipeline, so there is nothing left to hide, only a reason
 * owed to them.
 */
export default async function NewEnquiryPage() {
  const { user } = await requireModule('pipeline')
  const verdict = mayStartEnquiry(user)

  const options = verdict.ok ? await loadIntakeOptions(user) : null
  const refusal = verdict.ok ? null : verdict.why
  const defaultOwnerId =
    options && user.personId && options.people.some((p) => p.id === user.personId)
      ? user.personId
      : ''

  return (
    <div>
      <header className={styles.header}>
        <div>
          <Link href="/pipeline" className={styles.back}>
            <i className="ph ph-arrow-left" aria-hidden="true" />
            {user.external ? 'Your events' : 'Pipeline'}
          </Link>
          <h1 className={styles.title}>New enquiry</h1>
          <p className={styles.sub}>
            {user.external ? (
              <>
                <span className={styles.kicker}>
                  {user.organisationName ?? 'your organisation'}
                </span>{' '}
                · tell the venue about the night you have in mind
              </>
            ) : (
              <>
                <span className={styles.kicker}>the Crock</span> · start a booking — everything
                after this happens on the event record
              </>
            )}
          </p>
        </div>
      </header>

      <div className={styles.body}>
        {options ? (
          <EnquiryForm
            external={user.external}
            organisationName={user.organisationName}
            spaces={options.spaces}
            people={options.people}
            organisations={options.organisations}
            defaultOwnerId={defaultOwnerId}
            today={nightInput(venueToday())}
          />
        ) : (
          <p className={styles.refusal}>
            <i className="ph ph-warning" aria-hidden="true" />
            {refusal}
          </p>
        )}
      </div>
    </div>
  )
}
