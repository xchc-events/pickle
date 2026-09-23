'use client'

import { useState, useTransition } from 'react'
import type { Said } from '@/lib/toast'
import { useToast } from './Toast'
import styles from './CommentThread.module.css'

export interface CommentThreadRow {
  id: string
  who: string
  body: string
  /** `ago()`, computed once on the server so every reader sees the same word. */
  atLabel: string
}

/**
 * D5 — a comment thread, under one piece of design or an event's general
 * thread. Used on both Design and the promoter portal; what differs between
 * them is only the bound action, never this component.
 */
export function CommentThread({
  comments,
  post,
  placeholder = 'Add a comment',
}: {
  comments: readonly CommentThreadRow[]
  post: (body: string) => Promise<Said>
  placeholder?: string
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [text, setText] = useState('')

  return (
    <div className={styles.thread}>
      {comments.length ? (
        <ul className={styles.list}>
          {comments.map((c) => (
            <li key={c.id} className={styles.item}>
              <div className={styles.itemHead}>
                <span className={styles.who}>{c.who}</span>
                <span className={styles.at}>{c.atLabel}</span>
              </div>
              <p className={styles.body}>{c.body}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault()
          const body = text
          if (!body.trim()) return
          start(async () => {
            const said = await post(body)
            say(said)
            if (said.kind !== 'stop') setText('')
          })
        }}
      >
        <input
          className={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          disabled={pending}
        />
        <button type="submit" className="btn btn-ghost" disabled={pending || !text.trim()}>
          Post
        </button>
      </form>
    </div>
  )
}
