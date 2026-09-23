'use client'

import { useRef, useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import type { Said } from '@/lib/toast'
import type { VenueSpecComponentAdminRow } from '@/lib/venue-spec-data'
import styles from './admin.module.css'

/**
 * One section of the venue spec: its title and body, editable in place, and
 * a toggle for whether Tech offers it to send at all.
 *
 * Title and body save together, on blur of either — `updateVenueSpecComponent`
 * takes both, so a blur on the title alone still has to send the body as it
 * currently stands rather than whatever was last saved. `savedRef` is what a
 * repeat blur with nothing new typed is checked against, since the row's own
 * props go stale the moment the first save lands (`refresh()` re-renders the
 * page, but this component's local state, not its props, is what the field
 * now shows).
 */
export function VenueSpecComponentRow({
  component,
  update,
  setActive,
}: {
  component: VenueSpecComponentAdminRow
  update: (title: string, body: string) => Promise<Said>
  setActive: (active: boolean) => Promise<Said>
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [title, setTitle] = useState(component.title)
  const [body, setBody] = useState(component.body)
  const savedRef = useRef({ title: component.title, body: component.body })

  const saveIfChanged = () => {
    if (title === savedRef.current.title && body === savedRef.current.body) return
    start(async () => {
      const result = await update(title, body)
      if (result.kind !== 'stop') savedRef.current = { title, body }
      say(result)
    })
  }

  return (
    <li className={`${styles.specRow} ${component.active ? '' : styles.rowOff}`}>
      <div className={styles.specHead}>
        <span
          className={styles.specKey}
          title="Fixed — a past send still names this component by it"
        >
          {component.key}
        </span>
        <input
          className={styles.input}
          value={title}
          disabled={pending}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveIfChanged}
        />
        <button
          type="button"
          className={`${styles.toggle} ${component.active ? styles.toggleOn : ''}`}
          disabled={pending}
          title={
            component.active ? 'Take it out of what Tech offers to send' : 'Offer it again on Tech'
          }
          onClick={() => start(async () => say(await setActive(!component.active)))}
        >
          {component.active ? 'offered' : 'off'}
        </button>
      </div>
      <textarea
        className={styles.specBody}
        value={body}
        disabled={pending}
        rows={3}
        onChange={(e) => setBody(e.target.value)}
        onBlur={saveIfChanged}
      />
    </li>
  )
}
