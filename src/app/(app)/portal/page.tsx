import Link from 'next/link'
import { requireModule } from '@/lib/permissions'
import { loadPortal, type PortalAssetCard, type PortalEvent } from '@/lib/portal-data'
import { mayStartEnquiry } from '@/lib/intake'
import { SectionHeading } from '@/components/SectionHeading'
import { PaymentDetailsForm } from '@/components/PaymentDetailsForm'
import { ActionButton } from '@/components/ActionButton'
import { ReasonAction } from '@/components/ReasonAction'
import { CommentThread } from '@/components/CommentThread'
import { OpenArtwork } from '@/components/OpenArtwork'
import {
  approvePiece,
  askForChange,
  linkToArtwork,
  postPortalComment,
  reopenPiece,
  saveOwnDetails,
} from './actions'
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

        <div className={styles.sectionRow}>
          <SectionHeading note="everything your organisation has on">Your shows</SectionHeading>
          {mayStartEnquiry(user).ok ? (
            <Link href="/events/new" className={styles.bookLink}>
              <i className="ph ph-plus" aria-hidden="true" />
              Book a night
            </Link>
          ) : null}
        </div>

        {events.length === 0 ? (
          <p className={styles.none}>Nothing on at the moment.</p>
        ) : (
          <ul className={styles.events}>
            {events.map((e) => (
              <PortalEventRow key={e.id} event={e} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * D6/D3/D5 — one show: its summary row, unchanged, then the pieces of its
 * set that are past draft (each with Approve/Ask for a change, or Reopen
 * once it is signed off) and the event's general design thread.
 */
function PortalEventRow({ event: e }: { event: PortalEvent }) {
  return (
    <li className={styles.event}>
      <div className={styles.eventSummary}>
        <div className={styles.eventMain}>
          <span className={styles.eventName}>{e.name}</span>
          <span className={styles.eventDate}>{e.date}</span>
        </div>
        <span className={styles.eventStage}>{e.bookingLabel}</span>
        <span className={e.awaitingSignOff ? styles.warn : styles.quiet}>
          {e.awaitingSignOff ? `${e.awaitingSignOff} waiting on you` : 'nothing waiting on you'}
        </span>
      </div>

      {e.pieces.length ? (
        <div className={styles.pieces}>
          {e.pieces.map((p) => (
            <PortalPiece key={p.key} eventId={e.id} piece={p} />
          ))}
        </div>
      ) : null}

      {e.runSheet ? (
        <details className={styles.thread}>
          <summary className={styles.threadSummary}>Run sheet</summary>
          <ul className={styles.runSheet}>
            {e.runSheet.map((r, i) => (
              <li key={r.id ?? i} className={styles.runSheetRow}>
                <span className={styles.runSheetTime}>{r.time ?? '—'}</span>
                <span className={styles.runSheetItem}>
                  {r.item}
                  {r.who ? <span className={styles.runSheetWho}> · {r.who}</span> : null}
                </span>
                {r.note ? <span className={styles.runSheetNote}>{r.note}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className={styles.thread}>
        <summary className={styles.threadSummary}>
          {e.generalComments.length
            ? `${e.generalComments.length} ${e.generalComments.length === 1 ? 'comment' : 'comments'} on ${e.name}`
            : `Comment on ${e.name}`}
        </summary>
        <CommentThread
          comments={e.generalComments}
          post={postPortalComment.bind(null, e.id, null)}
          placeholder={`Comment on ${e.name}`}
        />
      </details>
    </li>
  )
}

function PortalPiece({ eventId, piece: p }: { eventId: string; piece: PortalAssetCard }) {
  return (
    <article className={styles.piece}>
      <div className={styles.pieceHead}>
        <div>
          <span className={styles.pieceName}>{p.name}</span>
          <span className={styles.pieceSpec}>{p.spec}</span>
        </div>
        <span className={`tag ${p.state === 'approved' ? 'tag-neutral' : styles.tagWarn}`}>
          {p.state === 'approved' ? 'signed off' : 'needs sign-off'}
        </span>
      </div>

      {p.file ? (
        <div className={styles.pieceFile}>
          <OpenArtwork eventId={eventId} fileId={p.file.id} link={linkToArtwork}>
            {p.file.name}
          </OpenArtwork>
          {p.file.version > 1 ? (
            <span className={styles.fileVersion}>v{p.file.version}</span>
          ) : null}
        </div>
      ) : null}

      {p.state === 'review' ? (
        <div className={styles.pieceActions}>
          <ActionButton
            className={`btn btn-primary ${styles.act}`}
            action={approvePiece.bind(null, eventId, p.key)}
          >
            Approve
          </ActionButton>
          <ReasonAction
            className={`btn btn-ghost ${styles.act}`}
            label="Ask for a change"
            placeholder="What needs to change?"
            action={askForChange.bind(null, eventId, p.key)}
          />
        </div>
      ) : (
        <div className={styles.pieceActions}>
          <ReasonAction
            className={`btn btn-ghost ${styles.act}`}
            label="Reopen"
            placeholder="Why does this need to reopen?"
            action={reopenPiece.bind(null, eventId, p.key)}
          />
        </div>
      )}

      <details className={styles.thread}>
        <summary className={styles.threadSummary}>
          {p.comments.length
            ? `${p.comments.length} ${p.comments.length === 1 ? 'comment' : 'comments'}`
            : 'Comment'}
        </summary>
        <CommentThread
          comments={p.comments}
          post={postPortalComment.bind(null, eventId, p.key)}
          placeholder={`Comment on ${p.name}`}
        />
      </details>
    </article>
  )
}
