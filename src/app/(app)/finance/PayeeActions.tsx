'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import type { Said } from '@/lib/toast'
import styles from './finance.module.css'

/**
 * The things Finance does to a payee that are not reading their account.
 *
 * Chasing and withdrawing are one control rather than two buttons, because
 * they are the two halves of one situation: either the details never came, or
 * the link went somewhere it should not have. Erasing sits apart and asks
 * first — it is the only destructive act on this page.
 */
export function PayeeActions({
  onFile,
  openGrant,
  chase,
  revoke,
  forget,
  name,
}: {
  onFile: boolean
  openGrant: boolean
  chase: () => Promise<{ ok: boolean; url?: string; why?: string }>
  revoke: () => Promise<Said>
  forget: () => Promise<Said>
  name: string
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [url, setUrl] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  if (url) {
    return (
      <div className={styles.linkBox}>
        <code className={styles.linkUrl}>{url}</code>
        <button
          type="button"
          className={styles.copy}
          onClick={() => void navigator.clipboard.writeText(url)}
        >
          <i className="ph ph-copy" aria-hidden="true" />
          Copy
        </button>
      </div>
    )
  }

  if (confirming) {
    return (
      <div className={styles.confirm}>
        <span className={styles.confirmText}>Erase {name}&rsquo;s details?</span>
        <button
          type="button"
          className={styles.confirmYes}
          disabled={pending}
          onClick={() =>
            start(async () => {
              say(await forget())
              setConfirming(false)
            })
          }
        >
          Erase
        </button>
        <button type="button" className={styles.confirmNo} onClick={() => setConfirming(false)}>
          Keep
        </button>
      </div>
    )
  }

  return (
    <div className={styles.payeeActions}>
      {openGrant ? (
        <button
          type="button"
          className={styles.ghost}
          disabled={pending}
          title="Stop the live link working"
          onClick={() => start(async () => say(await revoke()))}
        >
          <i className="ph ph-link-break" aria-hidden="true" />
          Withdraw link
        </button>
      ) : (
        <button
          type="button"
          className={styles.ghost}
          disabled={pending}
          title="Issue a link asking them for their details"
          onClick={() =>
            start(async () => {
              const res = await chase()
              if (!res.ok || !res.url) {
                say({ kind: 'stop', text: res.why ?? 'That did not work.' })
                return
              }
              setUrl(res.url)
            })
          }
        >
          <i className="ph ph-paper-plane-tilt" aria-hidden="true" />
          {onFile ? 'Ask again' : 'Ask for details'}
        </button>
      )}

      {onFile ? (
        <button
          type="button"
          className={styles.ghost}
          title="Erase — once the show is settled there is no reason to hold this"
          onClick={() => setConfirming(true)}
        >
          <i className="ph ph-eraser" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
