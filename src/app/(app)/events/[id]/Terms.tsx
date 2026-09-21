'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import { SPLIT_PRESETS, type Figures } from '@/lib/terms'
import { setFigures, setModel, setSplit } from './actions'
import styles from './event.module.css'

/**
 * The terms controls — split, booking model, and the figures the projection
 * runs off. Same idiom as Controls.tsx throughout: a control drafts a value
 * locally and hands it to the server action, which owns the write.
 *
 * The split and figures editors key an inner component off the saved prop
 * (see the two wrapper exports below), so a successful save remounts it with
 * a fresh draft rather than an effect syncing state after the fact. The
 * model picker needs none of that — it saves on every change, so the
 * control is never out of step with what was last asked for.
 */

function SplitEditorInner({ eventId, split }: { eventId: string; split: number }) {
  const say = useToast()
  const [pending, start] = useTransition()
  const saved = Math.round(split * 100)
  const [value, setValue] = useState(saved)

  return (
    <div className={styles.gates}>
      <span className={styles.gatesTitle}>Split</span>

      <div className={styles.splitRange}>
        <input
          type="range"
          aria-label="Percentage of the surplus that goes to their people"
          min={0}
          max={100}
          step={1}
          value={value}
          disabled={pending}
          onChange={(e) => setValue(Number(e.target.value))}
        />
        <span className={`${styles.splitReadout} tabular`}>{value}% to them</span>
      </div>

      <div className={styles.presets}>
        {SPLIT_PRESETS.map((p) => (
          <button
            key={p.percent}
            type="button"
            className={`${styles.chip} ${value === p.percent ? styles.chipOn : ''}`}
            disabled={pending}
            onClick={() => setValue(p.percent)}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={styles.smallBtn}
          disabled={pending || value === saved}
          onClick={() => start(async () => say(await setSplit(eventId, value)))}
        >
          Set the split
        </button>
      </div>
    </div>
  )
}

export function SplitEditor({ eventId, split }: { eventId: string; split: number }) {
  return <SplitEditorInner key={split} eventId={eventId} split={split} />
}

export function ModelPicker({ eventId, model }: { eventId: string; model: 'dry' | 'curator' }) {
  const say = useToast()
  const [pending, start] = useTransition()

  return (
    <label className={styles.timeField}>
      <span className={styles.factKey}>Booking model</span>
      <select
        className={styles.select}
        defaultValue={model}
        disabled={pending}
        onChange={(e) => start(async () => say(await setModel(eventId, e.target.value)))}
      >
        <option value="curator">Curator model</option>
        <option value="dry">Dry hire</option>
      </select>
    </label>
  )
}

function FiguresFormInner({ eventId, figures }: { eventId: string; figures: Figures }) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [quiet, setQuiet] = useState(figures.att[0])
  const [likely, setLikely] = useState(figures.att[1])
  const [great, setGreat] = useState(figures.att[2])
  const [barHead, setBarHead] = useState(figures.barHead)
  const [gear, setGear] = useState(figures.gear)
  const [adv, setAdv] = useState(figures.adv)
  const [crew, setCrew] = useState(figures.crew)
  const [tok, setTok] = useState(figures.tok)

  const dirty =
    quiet !== figures.att[0] ||
    likely !== figures.att[1] ||
    great !== figures.att[2] ||
    barHead !== figures.barHead ||
    gear !== figures.gear ||
    adv !== figures.adv ||
    crew !== figures.crew ||
    tok !== figures.tok

  const fields: [string, number, (n: number) => void][] = [
    ['Quiet', quiet, setQuiet],
    ['Likely', likely, setLikely],
    ['Great', great, setGreat],
    ['Bar spend per head', barHead, setBarHead],
    ['Gear & hire', gear, setGear],
    ['Promotion', adv, setAdv],
    ['Crew', crew, setCrew],
    ['Tokens per head', tok, setTok],
  ]

  return (
    <div className={styles.gates}>
      <span className={styles.gatesTitle}>What the projection runs off</span>

      <form
        className={styles.figGrid}
        action={() =>
          start(async () =>
            say(
              await setFigures(eventId, {
                att: [quiet, likely, great],
                barHead,
                gear,
                adv,
                crew,
                tok,
              }),
            ),
          )
        }
      >
        {fields.map(([label, value, onChange]) => (
          <label key={label} className={styles.timeField}>
            <span className={styles.factKey}>{label}</span>
            <input
              type="number"
              className={styles.select}
              min={0}
              step={1}
              value={value}
              disabled={pending}
              onChange={(e) => onChange(Number(e.target.value))}
            />
          </label>
        ))}

        <button type="submit" className={styles.smallBtn} disabled={pending || !dirty}>
          Save the figures
        </button>
      </form>

      <p className={styles.factNote}>
        Ticket prices are set in Ticketing · sound and the kind of night in Tech production
      </p>
    </div>
  )
}

export function FiguresForm({ eventId, figures }: { eventId: string; figures: Figures }) {
  const key = [
    ...figures.att,
    figures.barHead,
    figures.gear,
    figures.adv,
    figures.crew,
    figures.tok,
  ].join(':')
  return <FiguresFormInner key={key} eventId={eventId} figures={figures} />
}
