'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import { MIX_LABELS, mixProblem } from '@/lib/ticketing'
import type { Said } from '@/lib/toast'
import styles from './ticketing.module.css'

/**
 * The three things a coordinator changes here.
 *
 * Each is its own form with its own submit, rather than one big Save. They
 * are three separate decisions — what a ticket costs, who buys which tier,
 * and how many have gone — and bundling them would mean a person correcting
 * the sold count also re-submits a price they did not mean to touch.
 */

export function PriceForm({
  std,
  door,
  save,
}: {
  std: number
  door: number
  save: (form: FormData) => Promise<Said>
}) {
  const say = useToast()
  const [pending, start] = useTransition()

  return (
    <form className={styles.form} action={(f) => start(async () => say(await save(f)))}>
      <span className={styles.formTitle}>Prices</span>

      <label className={styles.field}>
        <span className={styles.label}>Standard</span>
        <input
          name="std"
          type="number"
          min="0"
          max="500"
          step="1"
          defaultValue={std}
          className={styles.input}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Door</span>
        <input
          name="door"
          type="number"
          min="0"
          max="500"
          step="1"
          defaultValue={door}
          className={styles.input}
        />
      </label>

      <button type="submit" className={styles.submit} disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </button>

      <p className={styles.formNote}>
        Supporter and subsidised are not typed — they are 80% and 120% of standard, so this one
        number moves three prices.
      </p>
    </form>
  )
}

/**
 * The four-way mix, as whole percentages.
 *
 * Shown as percentages because that is how a person thinks about it, and
 * checked live so the running total is visible before the submit rather than
 * as a rejection afterwards. The stored order is [supporter, standard,
 * subsidised, door] and the inputs are named to match it.
 */
export function MixForm({ mix, save }: { mix: number[]; save: (form: FormData) => Promise<Said> }) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [values, setValues] = useState(mix.map((n) => Math.round(n * 100)))

  const total = values.reduce((a, b) => a + b, 0)
  const problem = mixProblem(values.map((n) => n / 100))
  const names = ['sub', 'std', 'sup', 'door']

  return (
    <form className={styles.form} action={(f) => start(async () => say(await save(f)))}>
      <span className={styles.formTitle}>Mix</span>

      {values.map((v, i) => (
        <label key={names[i]} className={styles.field}>
          <span className={styles.label}>{MIX_LABELS[i]}</span>
          <input
            name={names[i]}
            type="number"
            min="0"
            max="100"
            step="1"
            value={v}
            className={styles.input}
            onChange={(e) =>
              setValues((prev) => prev.map((p, j) => (j === i ? Number(e.target.value) : p)))
            }
          />
        </label>
      ))}

      <button type="submit" className={styles.submit} disabled={pending || problem !== null}>
        {pending ? 'Saving…' : 'Save'}
      </button>

      <p
        className={`${styles.formNote} ${problem ? styles.stop : total === 100 ? styles.good : ''}`}
      >
        {problem ?? `${total}% — that makes a whole.`}
      </p>
    </form>
  )
}

export function SoldForm({
  sold,
  save,
}: {
  sold: number
  save: (form: FormData) => Promise<Said>
}) {
  const say = useToast()
  const [pending, start] = useTransition()

  return (
    <form className={styles.form} action={(f) => start(async () => say(await save(f)))}>
      <span className={styles.formTitle}>Sold</span>

      <label className={styles.field}>
        <span className={styles.label}>Tickets gone</span>
        <input
          name="sold"
          type="number"
          min="0"
          step="1"
          defaultValue={sold}
          className={styles.input}
        />
      </label>

      <button type="submit" className={styles.submit} disabled={pending}>
        {pending ? 'Saving…' : 'Save'}
      </button>

      <p className={styles.formNote}>
        Typed by hand for now. Gather.rsvp is the source of truth — once it is connected this reads
        itself and stops being somebody&rsquo;s typing.
      </p>
    </form>
  )
}
