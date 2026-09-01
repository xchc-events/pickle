'use client'

import { useTransition } from 'react'
import { useToast } from '@/components/Toast'
import styles from './design.module.css'

/**
 * Open a piece of artwork.
 *
 * The URL is signed on demand and lives fifteen minutes, so there is nothing
 * here to paste into a group chat that still works tomorrow. It always
 * downloads rather than rendering inline — artwork can be an SVG, and an SVG
 * rendered from an origin the app shares would run its own script.
 */
export function OpenArtwork({
  eventId,
  fileId,
  link,
  children,
}: {
  eventId: string
  fileId: string
  link: (eventId: string, fileId: string) => Promise<string | null>
  children: React.ReactNode
}) {
  const say = useToast()
  const [pending, start] = useTransition()

  return (
    <button
      type="button"
      className={styles.artworkOpen}
      disabled={pending}
      title="Download — the link is signed and expires"
      onClick={() =>
        start(async () => {
          const url = await link(eventId, fileId)
          if (!url) {
            say({ kind: 'stop', text: 'That file is not available.' })
            return
          }
          window.location.href = url
        })
      }
    >
      <i className="ph ph-download-simple" aria-hidden="true" />
      <span className={styles.artworkName}>{children}</span>
    </button>
  )
}
