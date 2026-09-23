'use client'

import { useMemo, useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import type { Said } from '@/lib/toast'
import { dateLabel } from '@/lib/format'
import { assembleVenueSpecText, type VenueSpecComponentRow } from '@/lib/venue-spec'
import type { EventRecipient } from '@/lib/tech-data'
import type { VenueSpecSendSummary } from '@/lib/venue-spec-data'
import styles from './tech.module.css'

function toggled(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/**
 * "Send the venue spec": tick which components go, tick who it goes to, see
 * exactly what that assembles into, send.
 *
 * Connor, 23 Sep 2026: "It'd be better to have a more full-featured option
 * where you can select which components of a venue spec sheet you're
 * sending out, as not all of them are relevant to all people. It doesn't
 * make sense that it says 'venue spec sent' and then 'add it yourself',
 * because this will only be uploading on our end, whereas we want it to be
 * emailed out." The preview is assembled client-side with the same
 * `assembleVenueSpecText` the send action itself uses, so what is shown
 * here is exactly what goes out, not a reasonable guess at it.
 */
export function SendVenueSpec({
  components,
  recipients,
  latestSend,
  send,
}: {
  components: VenueSpecComponentRow[]
  recipients: EventRecipient[]
  latestSend: VenueSpecSendSummary | null
  send: (componentKeys: string[], payeeIds: string[]) => Promise<Said>
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(components.map((c) => c.key)),
  )
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())

  const text = useMemo(() => assembleVenueSpecText(components, [...ticked]), [components, ticked])

  return (
    <div className={styles.specSend}>
      <p className={latestSend ? styles.good : styles.quiet}>
        <i
          className={`ph ${latestSend ? 'ph-check-circle' : 'ph-circle-dashed'}`}
          aria-hidden="true"
        />
        {latestSend
          ? `sent to ${latestSend.recipientNames.join(', ')} on ${dateLabel(latestSend.sentAt)}${latestSend.sentByName ? ` by ${latestSend.sentByName}` : ''}`
          : 'not sent yet'}
      </p>

      {components.length === 0 ? (
        <p className={styles.none}>
          No components to send — an administrator adds these in Admin, &ldquo;Venue spec&rdquo;.
        </p>
      ) : (
        <div className={styles.specPickers}>
          <fieldset className={styles.specFieldset} disabled={pending}>
            <legend>Components</legend>
            {components.map((c) => (
              <label key={c.key} className={styles.specCheck}>
                <input
                  type="checkbox"
                  checked={ticked.has(c.key)}
                  onChange={() => setTicked(toggled(ticked, c.key))}
                />
                {c.title}
              </label>
            ))}
          </fieldset>

          <fieldset className={styles.specFieldset} disabled={pending}>
            <legend>Recipients</legend>
            {recipients.length === 0 ? (
              <p className={styles.none}>No act or promoter with an email on this event yet.</p>
            ) : (
              recipients.map((r) => (
                <label
                  key={r.payeeId}
                  className={styles.specCheck}
                  title={r.email ?? 'No email on file'}
                >
                  <input
                    type="checkbox"
                    checked={chosen.has(r.payeeId)}
                    disabled={!r.email}
                    onChange={() => setChosen(toggled(chosen, r.payeeId))}
                  />
                  {r.name}
                  {!r.email ? <span className={styles.noEmail}>no email on file</span> : null}
                </label>
              ))
            )}
          </fieldset>
        </div>
      )}

      <pre className={styles.specPreview}>
        {text || '— pick at least one component to preview it —'}
      </pre>

      <button
        type="button"
        className="btn btn-primary"
        disabled={pending || ticked.size === 0 || chosen.size === 0}
        onClick={() =>
          start(async () => {
            say(await send([...ticked], [...chosen]))
          })
        }
      >
        Send the venue spec
      </button>
    </div>
  )
}
