'use client'

import { useState, useTransition } from 'react'
import type { FieldError } from '@/lib/payments'
import styles from './PaymentDetailsForm.module.css'

/**
 * Where an artist or a promoter types their own bank details.
 *
 * This is the only form in the product filled in by somebody outside the
 * venue, usually once, usually on a phone, often by a person who has never
 * seen this software before and will never see it again. So:
 *
 *  - Every problem is reported at once. A second round of one-error-at-a-time
 *    is how a form gets abandoned.
 *  - Nothing is read back. Once details are saved the form shows the mask,
 *    like it does for everybody — the person who typed it does not get a
 *    privileged view of it afterwards.
 *  - The reason each field is wanted is written next to it. Somebody being
 *    asked for an IRD number by a venue they have played once deserves to
 *    know why.
 */

export interface SaveResponse {
  ok: boolean
  errors?: FieldError[]
  /** A problem that is not about any one field. Shown above the form. */
  general?: string
}

export function PaymentDetailsForm({
  save,
  payeeName,
  country: initialCountry,
  onFile,
  maskedAccount,
}: {
  save: (form: {
    account: string
    accountName: string
    ird: string
    country: string
  }) => Promise<SaveResponse>
  payeeName: string
  country: string
  /** Whether details are already held. Changes the copy, not the fields. */
  onFile: boolean
  maskedAccount: string
}) {
  const [account, setAccount] = useState('')
  const [accountName, setAccountName] = useState(payeeName)
  const [ird, setIrd] = useState('')
  const [country, setCountry] = useState(initialCountry)
  const [errors, setErrors] = useState<FieldError[]>([])
  const [general, setGeneral] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, start] = useTransition()

  const errorFor = (field: string) => errors.find((e) => e.field === field)?.message

  if (done) {
    return (
      <div className={styles.done} role="status">
        <i className="ph ph-seal-check" aria-hidden="true" />
        <div>
          <p className={styles.doneTitle}>That is with the venue.</p>
          <p className={styles.doneNote}>
            Your details are encrypted and only the finance team can open them. Nobody at the venue
            can see the full number on a screen without it being recorded against your booking. You
            can close this page.
          </p>
        </div>
      </div>
    )
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const res = await save({ account, accountName, ird, country })
          if (res.ok) {
            setDone(true)
            return
          }
          setErrors(res.errors ?? [])
          setGeneral(res.general ?? null)
        })
      }}
    >
      {general ? (
        <p className={styles.general} role="alert">
          <i className="ph ph-warning-octagon" aria-hidden="true" />
          {general}
        </p>
      ) : null}

      {onFile ? (
        <p className={styles.existing}>
          We already hold an account ending <strong>{maskedAccount}</strong> for you. Filling this
          in replaces it.
        </p>
      ) : null}

      <label className={styles.field}>
        <span className={styles.label}>Where you pay tax</span>
        <select
          className={styles.select}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        >
          <option value="NZ">New Zealand</option>
          <option value="AU">Australia</option>
          <option value="GB">United Kingdom</option>
          <option value="US">United States</option>
          <option value="OTHER">Somewhere else</option>
        </select>
        <span className={styles.why}>
          {country === 'NZ'
            ? 'NZ acts are paid in full and account for their own tax.'
            : 'Acts based overseas have tax withheld at source unless you hold a certificate of exemption. Tell the coordinator if you do.'}
        </span>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Bank account number</span>
        <input
          className={`${styles.input} ${errorFor('account') ? styles.bad : ''}`}
          value={account}
          inputMode="numeric"
          autoComplete="off"
          placeholder="01-0123-0123456-000"
          onChange={(e) => setAccount(e.target.value)}
        />
        {errorFor('account') ? (
          <span className={styles.error}>{errorFor('account')}</span>
        ) : (
          <span className={styles.why}>A New Zealand account. This is where the fee goes.</span>
        )}
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Name on the account</span>
        <input
          className={`${styles.input} ${errorFor('accountName') ? styles.bad : ''}`}
          value={accountName}
          autoComplete="off"
          onChange={(e) => setAccountName(e.target.value)}
        />
        {errorFor('accountName') ? (
          <span className={styles.error}>{errorFor('accountName')}</span>
        ) : (
          <span className={styles.why}>
            Exactly as the bank has it. A name that does not match is the usual reason a payment
            bounces back.
          </span>
        )}
      </label>

      <label className={styles.field}>
        <span className={styles.label}>
          IRD number{' '}
          {country === 'NZ' ? '' : <em className={styles.optional}>· if you have one</em>}
        </span>
        <input
          className={`${styles.input} ${errorFor('ird') ? styles.bad : ''}`}
          value={ird}
          inputMode="numeric"
          autoComplete="off"
          placeholder="049-091-850"
          onChange={(e) => setIrd(e.target.value)}
        />
        {errorFor('ird') ? (
          <span className={styles.error}>{errorFor('ird')}</span>
        ) : (
          <span className={styles.why}>
            Required to pay a New Zealand act without withholding tax at the no-declaration rate.
          </span>
        )}
      </label>

      <button type="submit" className={styles.submit} disabled={pending}>
        {pending ? 'Sending…' : onFile ? 'Replace my details' : 'Send to the venue'}
      </button>

      <p className={styles.footnote}>
        <i className="ph ph-lock-simple" aria-hidden="true" />
        Encrypted before it is stored. Read only by the finance team, and only against a booking
        they are paying you for.
      </p>
    </form>
  )
}
