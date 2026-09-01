'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import type { IssuedLink } from './actions'
import styles from './tech.module.css'

/**
 * Getting an act to fill in their own details.
 *
 * Two states, because they are two different decisions. Giving an act a payee
 * record is a claim that this name is a real, repeating act. Sending them a
 * link is a claim that this address is theirs. Rolling them into one button
 * would mean the second happened without anybody deciding it.
 *
 * The link is shown once and never again — it does not exist in readable form
 * anywhere after this render, so the copy button is the only chance to take
 * it. That is the point, not an oversight.
 */
export function ArtistLink({
  hasPayee,
  issue,
  link,
}: {
  hasPayee: boolean
  issue: () => Promise<IssuedLink>
  link: () => Promise<{ kind: 'good' | 'warn' | 'stop'; text: string }>
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (url) {
    return (
      <div className={styles.linkBox}>
        <p className={styles.linkNote}>
          Send this to them. It is shown once — closing this page loses it, and you would have to
          issue a new one.
        </p>
        <div className={styles.linkRow}>
          <code className={styles.linkUrl}>{url}</code>
          <button
            type="button"
            className={styles.copy}
            onClick={() => {
              void navigator.clipboard.writeText(url)
              setCopied(true)
            }}
          >
            <i className={`ph ${copied ? 'ph-check' : 'ph-copy'}`} aria-hidden="true" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    )
  }

  if (!hasPayee) {
    return (
      <button
        type="button"
        className={styles.smallButton}
        disabled={pending}
        onClick={() => start(async () => say(await link()))}
      >
        <i className="ph ph-user-plus" aria-hidden="true" />
        Give them a record
      </button>
    )
  }

  return (
    <button
      type="button"
      className={styles.smallButton}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await issue()
          if (!res.ok || !res.url) {
            say({ kind: 'stop', text: res.why ?? 'That did not work.' })
            return
          }
          setUrl(res.url)
        })
      }
    >
      <i className="ph ph-link" aria-hidden="true" />
      Send them a link
    </button>
  )
}
