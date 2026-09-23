import { notFound } from 'next/navigation'
import { dateLabel } from '@/lib/format'
import { resolveShiftOfferToken } from '@/lib/shift-offers-data'
import { confirmViaToken, declineViaToken } from './actions'
import styles from './offer.module.css'

/**
 * What somebody offered a shift sees — R6.
 *
 * Deliberately outside the (app) route group: no sidebar, no session, no
 * navigation anywhere else, same reasoning as `src/app/g/[token]`. Unlike a
 * grant, though, a token that has gone stale is not a 404: it resolves,
 * `live: false`, with a message, and the page says what happened —
 * "already confirmed", "expired", "no longer live" — rather than pretending
 * the link was never real. Only a token nothing matches at all (malformed,
 * or one this install never issued) is a 404.
 *
 * Plain `<form action>`s, no client component: a Server Action is a real
 * POST endpoint, and the page re-reads the offer after either one runs, so
 * the result is simply the next render of this same route.
 */
export default async function ShiftOfferPage({ params }: PageProps<'/s/[token]'>) {
  const { token } = await params
  const offer = await resolveShiftOfferToken(token)
  if (!offer) notFound()

  const first = offer.personName.trim().split(/\s+/)[0] || offer.personName
  const call = offer.times ? `${offer.times} (${offer.hours}h)` : `${offer.hours}h`

  // Inline Server Actions: a plain `<form action>` wants `Promise<void>`, not
  // the `Said` `confirmViaToken`/`declineViaToken` return for a caller that
  // reads it (Roster and Home do). This page reads nothing back — the next
  // render of this same route, after the mutation, is the result.
  async function confirm() {
    'use server'
    await confirmViaToken(token)
  }
  async function decline() {
    'use server'
    await declineViaToken(token)
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <header className={styles.head}>
          <span className={styles.venue}>XCHC · Ōtautahi Christchurch</span>
          <h1 className={styles.title}>{offer.role}</h1>
          <p className={styles.event}>
            {offer.eventName} · {dateLabel(offer.eventDate)}
          </p>
        </header>

        <p className={styles.intro}>
          Kia ora {first}, you’re offered this shift — {call}.
        </p>

        {offer.live ? (
          <div className={styles.actions}>
            <form action={confirm}>
              <button type="submit" className={styles.confirm}>
                I can do this — confirm
              </button>
            </form>
            <form action={decline}>
              <button type="submit" className={styles.decline}>
                I can’t make this one
              </button>
            </form>
          </div>
        ) : (
          <p className={styles.message}>{offer.message}</p>
        )}

        <footer className={styles.foot}>This link is yours alone.</footer>
      </div>
    </div>
  )
}
