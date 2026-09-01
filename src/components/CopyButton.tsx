'use client'

import type { ToastKind } from '@/lib/toast'
import { useToast } from './Toast'

/**
 * Hands the listing copy to whoever is posting by hand.
 *
 * The text comes off the event record, written once in Design — the point of
 * the button is that nobody retypes it into a caption box, and nobody has a
 * second version of it in a chat thread.
 */
export function CopyButton({
  text,
  limit,
  className,
  children,
  message,
}: {
  text: string
  /** Where this channel cuts the caption off, if it does. */
  limit?: number
  className?: string
  children: React.ReactNode
  message: string
}) {
  const say = useToast()

  const copy = async () => {
    const out = limit && text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text
    try {
      await navigator.clipboard.writeText(out)
      say({ kind: 'good', text: message })
    } catch {
      // Clipboard access is refused outside a secure context, and by some
      // browsers without a user gesture it recognises. Say so rather than
      // letting the person believe they are pasting the caption.
      say({
        kind: 'stop' as ToastKind,
        text: 'The browser would not give up the clipboard. Select the caption on Design and copy it by hand.',
      })
    }
  }

  return (
    <button type="button" className={className} onClick={copy}>
      {children}
    </button>
  )
}
