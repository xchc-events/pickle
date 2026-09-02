'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import { ORG_ROLES, TEAMS, effectOf } from '@/lib/hours'
import type { Said } from '@/lib/toast'
import styles from './hours.module.css'

/**
 * Logging an hour.
 *
 * The sentence under the form is the point of the whole module. The handoff
 * calls Hours "the module that makes the profit share arguable", and an
 * argument only works if everybody could see the consequence before it
 * happened — so the effect line updates as you type, before anything is
 * committed, and names the show whose surplus the money comes off.
 *
 * It is computed here from the same `effectOf` the tests cover, rather than
 * being written twice for the client.
 */
export function LogHours({
  events,
  months,
  log,
  canLog,
}: {
  events: { id: string; label: string }[]
  months: { key: string; label: string; events: number }[]
  log: (form: FormData) => Promise<Said>
  /** False when the account has no person behind it. */
  canLog: boolean
}) {
  const say = useToast()
  const [pending, start] = useTransition()

  const [kind, setKind] = useState<'event' | 'org'>('event')
  const [hours, setHours] = useState('')
  const [role, setRole] = useState<string>(TEAMS[0])
  const [eventId, setEventId] = useState(events[0]?.id ?? '')
  const [month, setMonth] = useState(months[0]?.key ?? '')

  const roles = kind === 'org' ? ORG_ROLES : TEAMS
  const chosenMonth = months.find((m) => m.key === month)
  const effect = effectOf({
    hours: Number(hours) || 0,
    kind,
    role,
    target:
      kind === 'event'
        ? (events.find((e) => e.id === eventId)?.label.split(' · ')[0] ?? 'the event')
        : (chosenMonth?.label ?? 'that month'),
    eventsInMonth: chosenMonth?.events ?? 0,
  })

  function switchKind(next: 'event' | 'org') {
    setKind(next)
    // The role lists barely overlap, so a role carried across would usually
    // be one the other kind does not offer.
    setRole(next === 'org' ? ORG_ROLES[0] : TEAMS[0])
  }

  if (!canLog) {
    return (
      <p className={styles.cannot}>
        <i className="ph ph-warning" aria-hidden="true" />
        This account is not linked to a person, so there is nowhere to put hours. An administrator
        can link it in Admin.
      </p>
    )
  }

  return (
    <form
      className={styles.log}
      action={(form) =>
        start(async () => {
          const said = await log(form)
          if (said.kind === 'good') setHours('')
          say(said)
        })
      }
    >
      <input type="hidden" name="kind" value={kind} />

      <div className={styles.kinds}>
        {(['event', 'org'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`${styles.kind} ${kind === k ? styles.kindOn : ''}`}
            onClick={() => switchKind(k)}
          >
            {k === 'event' ? 'Against an event' : 'Org-wide role'}
          </button>
        ))}
      </div>

      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>Hours</span>
          <input
            name="hours"
            type="number"
            step="0.25"
            min="0.25"
            max="24"
            required
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            className={styles.input}
            placeholder="2.5"
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>{kind === 'org' ? 'Org-wide role' : 'Team'}</span>
          <select
            name="role"
            className={styles.input}
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        {kind === 'event' ? (
          <label className={`${styles.field} ${styles.wide}`}>
            <span className={styles.label}>Event</span>
            <select
              name="eventId"
              className={styles.input}
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
            >
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className={styles.field}>
            <span className={styles.label}>Month worked</span>
            <select
              name="month"
              className={styles.input}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              {months.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label} · {m.events} {m.events === 1 ? 'event' : 'events'}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={`${styles.field} ${styles.wide}`}>
          <span className={styles.label}>What you did</span>
          <input
            name="note"
            type="text"
            className={styles.input}
            placeholder="optional — the detail, not the team"
          />
        </label>

        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? 'Logging…' : 'Log it'}
        </button>
      </div>

      <p className={`${styles.effect} ${styles[effect.tone]}`} aria-live="polite">
        {effect.text}
      </p>
    </form>
  )
}
