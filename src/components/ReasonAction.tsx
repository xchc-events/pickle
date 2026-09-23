'use client'

import { useState, useTransition } from 'react'
import type { Said } from '@/lib/toast'
import { useToast } from './Toast'
import styles from './ReasonAction.module.css'

/**
 * A button that asks for one line of text before it runs a server action
 * with it — Ask for a change, Reopen, anything where the reason is the
 * point rather than an afterthought. Starts as a plain button; clicking it
 * opens the line in place, so the ask and the field stay where the person
 * was looking.
 *
 * Collapses back to the plain button on a successful submit or on Cancel.
 * A refusal (`kind: 'stop'`) leaves the field open with what was typed, so
 * a validation message ("Say why...") is not also a reason to retype it.
 */
export function ReasonAction({
  action,
  label,
  placeholder,
  className,
}: {
  action: (reason: string) => Promise<Said>
  label: string
  placeholder: string
  className?: string
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')

  if (!open) {
    return (
      <button type="button" className={className} disabled={pending} onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault()
        const reason = text
        start(async () => {
          const said = await action(reason)
          say(said)
          if (said.kind !== 'stop') {
            setOpen(false)
            setText('')
          }
        })
      }}
    >
      <input
        autoFocus
        className={styles.input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        disabled={pending}
      />
      <button type="submit" className="btn btn-primary" disabled={pending || !text.trim()}>
        {label}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={pending}
        onClick={() => {
          setOpen(false)
          setText('')
        }}
      >
        Cancel
      </button>
    </form>
  )
}
