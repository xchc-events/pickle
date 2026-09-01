'use client'

import { useTransition } from 'react'
import type { Said } from '@/lib/toast'
import { useToast } from './Toast'

/**
 * A button that runs one server action and says what followed from it.
 *
 * The action is the security boundary, not this — it re-checks the module
 * permission and the event scope for itself. This only carries the click and
 * the toast.
 */
export function ActionButton({
  action,
  className,
  title,
  children,
}: {
  action: () => Promise<Said | void>
  className?: string
  title?: string
  children: React.ReactNode
}) {
  const say = useToast()
  const [pending, start] = useTransition()

  return (
    <button
      type="button"
      className={className}
      title={title}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const said = await action()
          if (said) say(said)
        })
      }
    >
      {children}
    </button>
  )
}
