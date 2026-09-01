'use client'

import { useTransition } from 'react'
import { useToast } from '@/components/Toast'
import styles from './tech.module.css'

/**
 * Opening a file.
 *
 * The link is signed on demand and lives fifteen minutes, so there is no URL
 * here to copy and paste into a group chat — asking for it is what proves the
 * asker still had access when they asked. It always downloads rather than
 * rendering: an uploaded SVG shown inline would run its own script.
 */
export function OpenFile({
  fileId,
  link,
  children,
}: {
  fileId: string
  link: (fileId: string) => Promise<string | null>
  children: React.ReactNode
}) {
  const say = useToast()
  const [pending, start] = useTransition()

  return (
    <button
      type="button"
      className={styles.open}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const url = await link(fileId)
          if (!url) {
            say({ kind: 'stop', text: 'That file is not available.' })
            return
          }
          window.location.href = url
        })
      }
    >
      <i className="ph ph-download-simple" aria-hidden="true" />
      {children}
    </button>
  )
}
