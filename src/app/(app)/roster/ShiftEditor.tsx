'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import { ActionButton } from '@/components/ActionButton'
import type { Said } from '@/lib/toast'
import styles from './roster.module.css'

/**
 * Reshaping one shift: rename it, move its call, duplicate it, delete it.
 *
 * Connor, 23 Sep 2026: "I need the ability to actually manipulate these
 * shifts, rather than just the person on them... duplicate a shift or
 * delete a shift... and change the title of these things."
 *
 * Closed by default -- a dense roster is read far more often than it is
 * reshaped, so the row stays quiet until asked. Renaming and retiming share
 * one Save because they read as one edit to whoever is doing it; the two are
 * still separate server actions underneath (see actions.ts), each with its
 * own rule about what it may touch.
 */
export function ShiftEditor({
  role,
  startInput,
  endInput,
  rename,
  retime,
  duplicate,
  del,
}: {
  role: string
  startInput: string
  endInput: string
  rename: (role: string) => Promise<Said>
  retime: (input: { start: string; end: string }) => Promise<Said>
  duplicate: () => Promise<Said>
  del: () => Promise<Said>
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)
  const [roleValue, setRoleValue] = useState(role)
  const [startValue, setStartValue] = useState(startInput)
  const [endValue, setEndValue] = useState(endInput)

  if (!open) {
    return (
      <button
        type="button"
        className={styles.editToggle}
        onClick={() => {
          setRoleValue(role)
          setStartValue(startInput)
          setEndValue(endInput)
          setOpen(true)
        }}
        title="Edit, duplicate or delete this shift"
      >
        <i className="ph ph-pencil-simple" aria-hidden="true" />
        edit
      </button>
    )
  }

  const roleChanged = roleValue.trim() !== role && roleValue.trim() !== ''
  const timesChanged = startValue !== startInput || endValue !== endInput
  const canSave = (roleChanged || timesChanged) && !pending

  const save = () => {
    start(async () => {
      let out: Said | null = null

      if (roleChanged) {
        out = await rename(roleValue.trim())
        if (out.kind === 'stop') {
          say(out)
          return
        }
      }

      if (timesChanged) {
        out = await retime({ start: startValue, end: endValue })
      }

      if (out) say(out)
      if (!out || out.kind !== 'stop') setOpen(false)
    })
  }

  return (
    <form
      className={styles.editor}
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <input
        className={styles.editorRole}
        value={roleValue}
        onChange={(e) => setRoleValue(e.target.value)}
        disabled={pending}
        aria-label="Role"
      />
      <span className={styles.editorTimes}>
        <input
          type="time"
          className={styles.editorTime}
          value={startValue}
          onChange={(e) => setStartValue(e.target.value)}
          disabled={pending}
          aria-label="Start"
        />
        <span aria-hidden="true">to</span>
        <input
          type="time"
          className={styles.editorTime}
          value={endValue}
          onChange={(e) => setEndValue(e.target.value)}
          disabled={pending}
          aria-label="End"
        />
      </span>
      <span className={styles.editorActions}>
        <button type="submit" className={styles.editorSave} disabled={!canSave}>
          Save
        </button>
        <ActionButton
          className={styles.editorDuplicate}
          action={duplicate}
          title="Add another shift the same as this one, open"
        >
          Duplicate
        </ActionButton>
        <ActionButton className={styles.editorDelete} action={del} title="Remove this shift">
          Delete
        </ActionButton>
        <button
          type="button"
          className={styles.editorCancel}
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </button>
      </span>
    </form>
  )
}
