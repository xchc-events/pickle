'use client'

import { useMemo, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { SectionHeading } from '@/components/SectionHeading'
import {
  ACT_STATUSES,
  FIELD,
  FIELD_ORDER,
  FORMATS,
  FORMAT_FOR_KIND,
  HOUSE_STARTING_POINTS,
  KINDS,
  MAX_ACTS,
  MODELS,
  SOUNDS,
  usualAttendance,
  type FieldErrors,
  type FieldKey,
  type Format,
  type IntakeSpace,
  type Kind,
} from '@/lib/intake'
import { nightFromInput } from '@/lib/night'
import { clockFromInput, endNightFor, runProblems } from '@/lib/run-times'
import {
  FEE_STEP,
  HOUSE_MIX,
  HOUSE_SPLIT_PERCENT,
  SPLIT_PRESETS,
  mixProblem,
  modelSaid,
} from '@/lib/terms'
import { tiers } from '@/lib/finance'
import { dateLabel, money } from '@/lib/format'
import { capacityOf } from '@/lib/ticketing'
import type { ModelInputs } from '@/lib/enquiry-model'
import { ModelPanel } from './ModelPanel'
import { startEnquiry } from './actions'
import styles from './new.module.css'

/**
 * The one form both a coordinator and an outside promoter fill in.
 *
 * They are not the same form wearing a disguise: an outside account's raw
 * input is whitelisted server-side in `cleanEnquiry` (src/lib/intake.ts) and
 * re-derived from the session in `createEnquiry`, whatever this component
 * sends — so a field absent here is belt, and the server is braces. Now that
 * the enquirer models the night, an outside account sees almost everything
 * the venue does — attendance, ticket prices, costs, the acts' fees —
 * because those figures are THEIR proposal, corrected by the venue
 * afterwards, never re-typed. What is still missing from an outside
 * account's DOM entirely, not merely hidden, is what nobody outside the
 * building can settle: who owns the booking, whose organisation it belongs
 * to, the split, the brief, whether the room is held, and each act's status
 * — permission is never a CSS concern, so the server fixes these too (see
 * the whitelist in `cleanEnquiry`).
 *
 * React 19 clears every uncontrolled field once a function `action` commits —
 * including on a *failed* submit, which would wipe out everything a person
 * just typed the moment the server hands back errors. So this form is a plain
 * `onSubmit` that calls `preventDefault` and reads `FormData` from the live
 * DOM itself, inside the transition, rather than an `action` prop. Nothing
 * here resets the form on failure; a person only loses what they typed by
 * choosing to change it.
 *
 * Most inputs are controlled now: the live model panel beside the form
 * (`ModelPanel`) reads every figure it needs straight out of this
 * component's state, assembled into `ModelInputs` below. A field the panel
 * never reads — the name, the note, an act's own name — stays uncontrolled,
 * same as before.
 */

const cls = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

/** A field's raw text as a number for the live model — blank and anything
 *  unparseable read as 0, same as `cleanEnquiry` treats them server-side. */
const n = (s: string): number => Number(s) || 0

/** Which control to focus for each field, walking `FIELD_ORDER` after a
 *  failed submit. A group field (an act row, the attendance spread, the
 *  ticket mix, the alternate dates) points at its first input. */
const FOCUS_NAME: Record<FieldKey, string> = {
  name: FIELD.name,
  date: FIELD.date,
  spaceId: FIELD.spaceId,
  kind: FIELD.kind,
  format: FIELD.format,
  doors: FIELD.doors,
  barClose: FIELD.barClose,
  allOut: FIELD.allOut,
  endDate: FIELD.endDate,
  acts: FIELD.actName,
  note: FIELD.note,
  alternates: FIELD.alt1,
  ownerId: FIELD.ownerId,
  model: FIELD.model,
  std: FIELD.std,
  door: FIELD.door,
  mix: FIELD.mixSub,
  bringing: FIELD.bringing,
  organisationId: FIELD.organisationId,
  promoterName: FIELD.promoterName,
  split: FIELD.split,
  att: FIELD.attQuiet,
  barHead: FIELD.barHead,
  gear: FIELD.gear,
  adv: FIELD.adv,
  sound: FIELD.sound,
  crew: FIELD.crew,
  tok: FIELD.tok,
  brief: FIELD.brief,
}

/** The attendance spread's starting figures, as the three text inputs hold
 *  them — a blank trio when there is no room to work from yet. */
function computeAtt(space: IntakeSpace | null, format: Format): [string, string, string] {
  if (!space) return ['', '', '']
  const usual = usualAttendance(capacityOf(space, format))
  return [String(usual[0]), String(usual[1]), String(usual[2])]
}

function invalidProps(id: string, message: string | undefined) {
  return message ? ({ 'aria-invalid': true, 'aria-describedby': id } as const) : {}
}

function ErrorText({ id, text }: { id: string; text: string | undefined }) {
  if (!text) return null
  return (
    <p id={id} className={styles.error} role="alert">
      {text}
    </p>
  )
}

interface ActRowState {
  id: number
  low: string
  high: string
}

function ActRow({
  index,
  external,
  low,
  high,
  onLowChange,
  onHighChange,
  onRemove,
}: {
  index: number
  external: boolean
  low: string
  high: string
  onLowChange: (value: string) => void
  onHighChange: (value: string) => void
  onRemove: () => void
}) {
  return (
    <div className={external ? styles.actRowSimple : styles.actRow}>
      <label className={styles.field}>
        <span className={styles.label}>Act {index + 1}</span>
        <input
          name={FIELD.actName}
          maxLength={80}
          placeholder="Act name"
          className={styles.input}
        />
      </label>
      {external ? null : (
        <label className={styles.field}>
          <span className={styles.label}>Status</span>
          <select name={FIELD.actStatus} defaultValue="enquired" className={styles.input}>
            {ACT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={styles.field}>
        <span className={styles.label}>Fee floor</span>
        <input
          name={FIELD.actLow}
          type="number"
          inputMode="decimal"
          step={FEE_STEP}
          placeholder="0"
          value={low}
          onChange={(e) => onLowChange(e.target.value)}
          className={styles.input}
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Fee ceiling</span>
        <input
          name={FIELD.actHigh}
          type="number"
          inputMode="decimal"
          step={FEE_STEP}
          placeholder="0"
          value={high}
          onChange={(e) => onHighChange(e.target.value)}
          className={styles.input}
        />
      </label>
      <button
        type="button"
        className={styles.remove}
        onClick={onRemove}
        aria-label={`Remove act ${index + 1}`}
      >
        <i className="ph ph-x" aria-hidden="true" />
      </button>
    </div>
  )
}

export function EnquiryForm({
  external,
  organisationName,
  spaces,
  people,
  organisations,
  defaultOwnerId,
  today,
}: {
  external: boolean
  organisationName: string | null
  spaces: IntakeSpace[]
  people: { id: string; name: string }[]
  organisations: { id: string; name: string }[]
  defaultOwnerId: string
  today: string
}) {
  const say = useToast()
  const router = useRouter()
  const [pending, start] = useTransition()
  // The transition ends the moment the action answers, which is before the
  // new event's page has loaded. Without this the button comes back to life in
  // that gap, and a second press starts the same enquiry twice.
  const [started, setStarted] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const formRef = useRef<HTMLFormElement>(null)

  // Room, kind and format drive each other's options, the attendance
  // prefill and the live model, so all three are tracked here even though a
  // few fields (the name, the note) are left uncontrolled — see the file
  // comment.
  const initialFormat = FORMAT_FOR_KIND[KINDS[0].value]
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? '')
  const [kind, setKind] = useState<Kind>(KINDS[0].value)
  const [format, setFormat] = useState<Format>(initialFormat)
  const [att, setAtt] = useState<[string, string, string]>(() =>
    computeAtt(spaces[0] ?? null, initialFormat),
  )
  // Once a person has typed into any of the three attendance inputs, a room
  // or format change must stop overwriting them — see spec §6.
  const [attEdited, setAttEdited] = useState(false)

  // Run times: free text now, not a pick-list, so the live "taken as" hint
  // and runProblems' messages need the raw values as they're typed.
  const [date, setDate] = useState('')
  const [doors, setDoors] = useState('')
  const [barClose, setBarClose] = useState('')
  const [allOut, setAllOut] = useState('')
  const [endDate, setEndDate] = useState('')

  // Tickets.
  const [std, setStd] = useState('')
  const [door, setDoor] = useState('')
  const [mixSub, setMixSub] = useState(String(HOUSE_MIX[0]))
  const [mixStd, setMixStd] = useState(String(HOUSE_MIX[1]))
  const [mixSup, setMixSup] = useState(String(HOUSE_MIX[2]))
  const [mixDoor, setMixDoor] = useState(String(HOUSE_MIX[3]))

  // Costs before anyone is paid.
  const [barHead, setBarHead] = useState(String(HOUSE_STARTING_POINTS.barHead))
  const [gear, setGear] = useState(String(HOUSE_STARTING_POINTS.gear))
  const [adv, setAdv] = useState(String(HOUSE_STARTING_POINTS.adv))
  const [sound, setSound] = useState<string>(HOUSE_STARTING_POINTS.sound)
  const [crew, setCrew] = useState(String(HOUSE_STARTING_POINTS.crew))
  const [tok, setTok] = useState(String(HOUSE_STARTING_POINTS.tok))

  // Venue only: the split (a plain number input, historically left blank —
  // the presets below are the fast path, not a default).
  const [split, setSplit] = useState('')

  const [bringing, setBringing] = useState<'venue' | 'organisation' | 'name'>(
    organisations.length > 0 ? 'organisation' : 'venue',
  )

  const [actRows, setActRows] = useState<ActRowState[]>([
    { id: 0, low: '', high: '' },
    { id: 1, low: '', high: '' },
  ])
  const nextActRowId = useRef(2)

  function recomputeAtt(nextSpaceId: string, nextFormat: Format) {
    if (attEdited) return
    const space = spaces.find((s) => s.id === nextSpaceId) ?? null
    setAtt(computeAtt(space, nextFormat))
  }

  function handleSpaceChange(e: ChangeEvent<HTMLSelectElement>) {
    setSpaceId(e.target.value)
    recomputeAtt(e.target.value, format)
  }

  function handleKindChange(e: ChangeEvent<HTMLSelectElement>) {
    const nextKind = e.target.value as Kind
    const nextFormat = FORMAT_FOR_KIND[nextKind]
    setKind(nextKind)
    setFormat(nextFormat)
    recomputeAtt(spaceId, nextFormat)
  }

  function handleFormatChange(e: ChangeEvent<HTMLSelectElement>) {
    const nextFormat = e.target.value as Format
    setFormat(nextFormat)
    recomputeAtt(spaceId, nextFormat)
  }

  function handleAttChange(index: 0 | 1 | 2, value: string) {
    setAttEdited(true)
    setAtt((prev) => {
      const next: [string, string, string] = [...prev]
      next[index] = value
      return next
    })
  }

  function addActRow() {
    setActRows((rows) =>
      rows.length >= MAX_ACTS ? rows : [...rows, { id: nextActRowId.current++, low: '', high: '' }],
    )
  }

  function removeActRow(id: number) {
    setActRows((rows) => rows.filter((r) => r.id !== id))
  }

  function updateActRow(id: number, patch: Partial<Pick<ActRowState, 'low' | 'high'>>) {
    setActRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function focusFirstInvalid(errs: FieldErrors) {
    const key = FIELD_ORDER.find((k) => errs[k])
    if (!key) return
    formRef.current?.querySelector<HTMLElement>(`[name="${FOCUS_NAME[key]}"]`)?.focus()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // See the file comment: reading FormData ourselves, from a plain
    // onSubmit, is what keeps a failed submit from wiping the form.
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setErrors({})
    start(async () => {
      const out = await startEnquiry(form)
      say(out.said)
      setErrors(out.errors)
      if (out.eventId) {
        setStarted(true)
        router.push(`/events/${out.eventId}`)
      } else {
        focusFirstInvalid(out.errors)
      }
    })
  }

  // --- the live run-times reading — see spec §2/§6 ------------------------
  const selectedSpace = spaces.find((s) => s.id === spaceId) ?? null
  const roomCapacity = selectedSpace ? capacityOf(selectedSpace, format) : null
  const startNight = nightFromInput(date)
  const doorsClock = clockFromInput(doors)
  const barCloseClock = clockFromInput(barClose)
  const allOutClock = clockFromInput(allOut)
  const impliedEndNight =
    startNight && endDate === '' ? endNightFor(startNight, doorsClock, allOutClock) : null
  const endDateNight = endDate === '' ? impliedEndNight : nightFromInput(endDate)
  const liveRunProblems = startNight
    ? runProblems({
        date: startNight,
        doors: doorsClock,
        barClose: barCloseClock,
        endDate: endDateNight,
        allOut: allOutClock,
      })
    : {}

  // --- tickets, live -------------------------------------------------------
  const tierPreview = tiers({ std: n(std), door: n(door) })
  const mixValues: [number, number, number, number] = [n(mixSub), n(mixStd), n(mixSup), n(mixDoor)]
  const mixTotal = mixValues.reduce((a, b) => a + b, 0)
  const mixIssue = mixProblem(mixValues)

  // --- what the live panel reads, assembled once a render ------------------
  const modelInputs: ModelInputs = useMemo(
    () => ({
      date: nightFromInput(date),
      space: selectedSpace,
      kind,
      format,
      barClose: clockFromInput(barClose),
      std: n(std),
      door: n(door),
      mix: [n(mixSub) / 100, n(mixStd) / 100, n(mixSup) / 100, n(mixDoor) / 100],
      att: [n(att[0]), n(att[1]), n(att[2])],
      barHead: n(barHead),
      gear: n(gear),
      adv: n(adv),
      sound,
      crew: n(crew),
      tok: n(tok),
      split: external ? HOUSE_SPLIT_PERCENT / 100 : n(split) / 100,
      acts: actRows.map((r) => ({ low: n(r.low), high: n(r.high) })),
    }),
    [
      date,
      selectedSpace,
      kind,
      format,
      barClose,
      std,
      door,
      mixSub,
      mixStd,
      mixSup,
      mixDoor,
      att,
      barHead,
      gear,
      adv,
      sound,
      crew,
      tok,
      external,
      split,
      actRows,
    ],
  )

  return (
    <>
      {external ? (
        <div className={styles.explainer}>
          <i className="ph ph-info" aria-hidden="true" />
          <div>
            <p className={styles.explainerText}>
              Nothing is booked until the venue confirms it. Your date is a preference until a
              coordinator locks it in.
            </p>
            {organisationName ? (
              <p className={styles.explainerSub}>Sending this as {organisationName}.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <form ref={formRef} className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.sections}>
          <section>
            <SectionHeading>The night</SectionHeading>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span className={styles.label}>Event name</span>
                <input
                  name={FIELD.name}
                  maxLength={120}
                  className={cls(styles.input, errors.name && styles.bad)}
                  {...invalidProps(`${FIELD.name}-error`, errors.name)}
                />
                <ErrorText id={`${FIELD.name}-error`} text={errors.name} />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Date</span>
                {/* Left blank on purpose. A date filled in for them is a date
                    nobody chose, and "tonight" is the worst one to book by
                    accident. */}
                <input
                  type="date"
                  name={FIELD.date}
                  min={external ? today : undefined}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={cls(styles.input, errors.date && styles.bad)}
                  {...invalidProps(`${FIELD.date}-error`, errors.date)}
                />
                <ErrorText id={`${FIELD.date}-error`} text={errors.date} />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Room</span>
                <select
                  name={FIELD.spaceId}
                  value={spaceId}
                  onChange={handleSpaceChange}
                  className={cls(styles.input, errors.spaceId && styles.bad)}
                  {...invalidProps(`${FIELD.spaceId}-error`, errors.spaceId)}
                >
                  {spaces.length === 0 ? <option value="">No rooms on the books</option> : null}
                  {spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <ErrorText id={`${FIELD.spaceId}-error`} text={errors.spaceId} />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Type of event</span>
                <select
                  name={FIELD.kind}
                  value={kind}
                  onChange={handleKindChange}
                  className={cls(styles.input, errors.kind && styles.bad)}
                  {...invalidProps(`${FIELD.kind}-error`, errors.kind)}
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <ErrorText id={`${FIELD.kind}-error`} text={errors.kind} />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Format</span>
                <select
                  name={FIELD.format}
                  value={format}
                  onChange={handleFormatChange}
                  className={cls(styles.input, errors.format && styles.bad)}
                  {...invalidProps(`${FIELD.format}-error`, errors.format)}
                >
                  {FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <ErrorText id={`${FIELD.format}-error`} text={errors.format} />
              </label>

              {external ? null : (
                <label className={styles.check}>
                  <input type="checkbox" name={FIELD.dateTbc} />
                  This date is a best guess
                </label>
              )}
            </div>
          </section>

          <section>
            <SectionHeading note="any minute, leave any as not decided until you know">
              Doors, bar and close
            </SectionHeading>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span className={styles.label}>Doors open</span>
                <input
                  type="time"
                  name={FIELD.doors}
                  value={doors}
                  onChange={(e) => setDoors(e.target.value)}
                  className={cls(styles.input, errors.doors && styles.bad)}
                  {...invalidProps(`${FIELD.doors}-error`, errors.doors)}
                />
                <ErrorText id={`${FIELD.doors}-error`} text={errors.doors} />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Bar closes</span>
                <input
                  type="time"
                  name={FIELD.barClose}
                  value={barClose}
                  onChange={(e) => setBarClose(e.target.value)}
                  className={cls(
                    styles.input,
                    (errors.barClose || liveRunProblems.barClose) && styles.bad,
                  )}
                  {...invalidProps(
                    `${FIELD.barClose}-error`,
                    errors.barClose || liveRunProblems.barClose,
                  )}
                />
                <ErrorText
                  id={`${FIELD.barClose}-error`}
                  text={errors.barClose || liveRunProblems.barClose}
                />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Ends</span>
                <input
                  type="date"
                  name={FIELD.endDate}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={cls(
                    styles.input,
                    (errors.endDate || liveRunProblems.endDate) && styles.bad,
                  )}
                  {...invalidProps(
                    `${FIELD.endDate}-error`,
                    errors.endDate || liveRunProblems.endDate,
                  )}
                />
                {endDate === '' && impliedEndNight ? (
                  <p className={styles.hint}>taken as {dateLabel(impliedEndNight)}</p>
                ) : null}
                <ErrorText
                  id={`${FIELD.endDate}-error`}
                  text={errors.endDate || liveRunProblems.endDate}
                />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Everyone out</span>
                <input
                  type="time"
                  name={FIELD.allOut}
                  value={allOut}
                  onChange={(e) => setAllOut(e.target.value)}
                  className={cls(
                    styles.input,
                    (errors.allOut || liveRunProblems.allOut) && styles.bad,
                  )}
                  {...invalidProps(
                    `${FIELD.allOut}-error`,
                    errors.allOut || liveRunProblems.allOut,
                  )}
                />
                <ErrorText
                  id={`${FIELD.allOut}-error`}
                  text={errors.allOut || liveRunProblems.allOut}
                />
              </label>
            </div>
          </section>

          <section>
            <SectionHeading>How we work together</SectionHeading>
            <fieldset className={styles.modelGroup}>
              <legend className={styles.visuallyHidden}>Booking model</legend>
              {MODELS.map((m) => (
                <div key={m.value} className={styles.modelOption}>
                  <label className={styles.radio}>
                    <input
                      type="radio"
                      name={FIELD.model}
                      value={m.value}
                      defaultChecked={m.value === 'curator'}
                    />
                    {m.label}
                  </label>
                  <p className={styles.modelNote}>{modelSaid(m.value).text}</p>
                </div>
              ))}
              <ErrorText id={`${FIELD.model}-error`} text={errors.model} />
            </fieldset>
          </section>

          <section>
            <SectionHeading note="subsidised and supporter follow the standard price">
              Tickets
            </SectionHeading>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span className={styles.label}>Standard price</span>
                <input
                  name={FIELD.std}
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={std}
                  onChange={(e) => setStd(e.target.value)}
                  className={cls(styles.input, errors.std && styles.bad)}
                  {...invalidProps(`${FIELD.std}-error`, errors.std)}
                />
                <ErrorText id={`${FIELD.std}-error`} text={errors.std} />
              </label>

              <div className={styles.field}>
                <span className={styles.label}>Subsidised / Supporter</span>
                <span className={cls(styles.input, styles.readout, 'tabular')}>
                  {money(tierPreview.sub)} / {money(tierPreview.sup)}
                </span>
              </div>

              <label className={styles.field}>
                <span className={styles.label}>Door price</span>
                <input
                  name={FIELD.door}
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={door}
                  onChange={(e) => setDoor(e.target.value)}
                  className={cls(styles.input, errors.door && styles.bad)}
                  {...invalidProps(`${FIELD.door}-error`, errors.door)}
                />
                <ErrorText id={`${FIELD.door}-error`} text={errors.door} />
              </label>

              <fieldset className={styles.mixGroup}>
                <legend className={styles.label}>Ticket mix</legend>
                <div className={styles.mixRow}>
                  <label className={styles.field}>
                    <span className={styles.label}>Subsidised</span>
                    <input
                      name={FIELD.mixSub}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={mixSub}
                      onChange={(e) => setMixSub(e.target.value)}
                      className={styles.input}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Standard</span>
                    <input
                      name={FIELD.mixStd}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={mixStd}
                      onChange={(e) => setMixStd(e.target.value)}
                      className={styles.input}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Supporter</span>
                    <input
                      name={FIELD.mixSup}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={mixSup}
                      onChange={(e) => setMixSup(e.target.value)}
                      className={styles.input}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Door</span>
                    <input
                      name={FIELD.mixDoor}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={mixDoor}
                      onChange={(e) => setMixDoor(e.target.value)}
                      className={styles.input}
                    />
                  </label>
                </div>
                <p
                  className={cls(
                    styles.mixNote,
                    mixIssue ? styles.mixBad : mixTotal === 100 && styles.mixGood,
                  )}
                >
                  {mixIssue ?? `${mixTotal}% — that makes a whole.`}
                </p>
              </fieldset>
            </div>
          </section>

          <section>
            <SectionHeading
              note={selectedSpace ? `${selectedSpace.name} holds ${roomCapacity}` : undefined}
            >
              Who turns up
            </SectionHeading>
            <fieldset className={styles.attGroup}>
              <legend className={styles.label}>Attendance — quiet, likely, great</legend>
              <div className={styles.attRow}>
                <label className={styles.field}>
                  <span className={styles.visuallyHidden}>Quiet night</span>
                  <input
                    name={FIELD.attQuiet}
                    type="number"
                    inputMode="numeric"
                    value={att[0]}
                    onChange={(e) => handleAttChange(0, e.target.value)}
                    className={cls(styles.input, errors.att && styles.bad)}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.visuallyHidden}>Likely night</span>
                  <input
                    name={FIELD.attLikely}
                    type="number"
                    inputMode="numeric"
                    value={att[1]}
                    onChange={(e) => handleAttChange(1, e.target.value)}
                    className={cls(styles.input, errors.att && styles.bad)}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.visuallyHidden}>Great night</span>
                  <input
                    name={FIELD.attGreat}
                    type="number"
                    inputMode="numeric"
                    value={att[2]}
                    onChange={(e) => handleAttChange(2, e.target.value)}
                    className={cls(styles.input, errors.att && styles.bad)}
                  />
                </label>
              </div>
              <ErrorText id="att-error" text={errors.att} />
            </fieldset>
          </section>

          <section>
            <SectionHeading>Costs before anyone is paid</SectionHeading>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span className={styles.label}>Bar spend per head</span>
                <input
                  name={FIELD.barHead}
                  type="number"
                  inputMode="decimal"
                  value={barHead}
                  onChange={(e) => setBarHead(e.target.value)}
                  className={cls(styles.input, errors.barHead && styles.bad)}
                  {...invalidProps(`${FIELD.barHead}-error`, errors.barHead)}
                />
                <ErrorText id={`${FIELD.barHead}-error`} text={errors.barHead} />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Gear & hire</span>
                <input
                  name={FIELD.gear}
                  type="number"
                  inputMode="decimal"
                  value={gear}
                  onChange={(e) => setGear(e.target.value)}
                  className={cls(styles.input, errors.gear && styles.bad)}
                  {...invalidProps(`${FIELD.gear}-error`, errors.gear)}
                />
                <ErrorText id={`${FIELD.gear}-error`} text={errors.gear} />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Promotion</span>
                <input
                  name={FIELD.adv}
                  type="number"
                  inputMode="decimal"
                  value={adv}
                  onChange={(e) => setAdv(e.target.value)}
                  className={cls(styles.input, errors.adv && styles.bad)}
                  {...invalidProps(`${FIELD.adv}-error`, errors.adv)}
                />
                <ErrorText id={`${FIELD.adv}-error`} text={errors.adv} />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Sound</span>
                <select
                  name={FIELD.sound}
                  value={sound}
                  onChange={(e) => setSound(e.target.value)}
                  className={cls(styles.input, errors.sound && styles.bad)}
                  {...invalidProps(`${FIELD.sound}-error`, errors.sound)}
                >
                  {SOUNDS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <ErrorText id={`${FIELD.sound}-error`} text={errors.sound} />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Crew</span>
                <input
                  name={FIELD.crew}
                  type="number"
                  inputMode="numeric"
                  value={crew}
                  onChange={(e) => setCrew(e.target.value)}
                  className={cls(styles.input, errors.crew && styles.bad)}
                  {...invalidProps(`${FIELD.crew}-error`, errors.crew)}
                />
                <ErrorText id={`${FIELD.crew}-error`} text={errors.crew} />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Tokens per head</span>
                <input
                  name={FIELD.tok}
                  type="number"
                  inputMode="numeric"
                  value={tok}
                  onChange={(e) => setTok(e.target.value)}
                  className={cls(styles.input, errors.tok && styles.bad)}
                  {...invalidProps(`${FIELD.tok}-error`, errors.tok)}
                />
                <ErrorText id={`${FIELD.tok}-error`} text={errors.tok} />
              </label>
            </div>
          </section>

          <section>
            <SectionHeading note={`up to ${MAX_ACTS} — more go in the note below`}>
              {external ? 'Your people' : 'The acts'}
            </SectionHeading>
            <div className={styles.acts}>
              {actRows.map((row, index) => (
                <ActRow
                  key={row.id}
                  index={index}
                  external={external}
                  low={row.low}
                  high={row.high}
                  onLowChange={(v) => updateActRow(row.id, { low: v })}
                  onHighChange={(v) => updateActRow(row.id, { high: v })}
                  onRemove={() => removeActRow(row.id)}
                />
              ))}
            </div>
            <div className={styles.actsFoot}>
              <button
                type="button"
                className={styles.addRow}
                onClick={addActRow}
                disabled={actRows.length >= MAX_ACTS}
              >
                <i className="ph ph-plus" aria-hidden="true" />
                Add an act
              </button>
              <ErrorText id="acts-error" text={errors.acts} />
            </div>
          </section>

          {external ? (
            <section>
              <SectionHeading>Who is bringing it</SectionHeading>
              <p className={styles.houseLine}>
                House standard {HOUSE_SPLIT_PERCENT}/{100 - HOUSE_SPLIT_PERCENT} — the split is
                settled with your coordinator.
              </p>
            </section>
          ) : (
            <section>
              <SectionHeading>Who is bringing it</SectionHeading>
              <fieldset className={styles.radioGroup}>
                <legend className={styles.visuallyHidden}>Who is bringing it</legend>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name={FIELD.bringing}
                    value="venue"
                    checked={bringing === 'venue'}
                    onChange={() => setBringing('venue')}
                  />
                  The venue itself
                </label>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name={FIELD.bringing}
                    value="organisation"
                    checked={bringing === 'organisation'}
                    onChange={() => setBringing('organisation')}
                  />
                  An organisation on file
                </label>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name={FIELD.bringing}
                    value="name"
                    checked={bringing === 'name'}
                    onChange={() => setBringing('name')}
                  />
                  Somebody not on file yet
                </label>
                <ErrorText id={`${FIELD.bringing}-error`} text={errors.bringing} />
              </fieldset>

              <div className={styles.grid}>
                {bringing === 'organisation' ? (
                  <label className={styles.field}>
                    <span className={styles.label}>Organisation</span>
                    <select
                      name={FIELD.organisationId}
                      defaultValue=""
                      className={cls(styles.input, errors.organisationId && styles.bad)}
                      {...invalidProps(`${FIELD.organisationId}-error`, errors.organisationId)}
                    >
                      <option value="">— choose one —</option>
                      {organisations.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    <ErrorText id={`${FIELD.organisationId}-error`} text={errors.organisationId} />
                  </label>
                ) : null}

                {bringing === 'name' ? (
                  <label className={styles.field}>
                    <span className={styles.label}>Their name</span>
                    <input
                      name={FIELD.promoterName}
                      maxLength={80}
                      className={cls(styles.input, errors.promoterName && styles.bad)}
                      {...invalidProps(`${FIELD.promoterName}-error`, errors.promoterName)}
                    />
                    <ErrorText id={`${FIELD.promoterName}-error`} text={errors.promoterName} />
                  </label>
                ) : null}

                <label className={styles.field}>
                  <span className={styles.label}>Owner</span>
                  <select
                    name={FIELD.ownerId}
                    defaultValue={defaultOwnerId}
                    className={styles.input}
                  >
                    <option value="">Nobody yet</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="split-input">
                    Split %
                  </label>
                  <input
                    id="split-input"
                    name={FIELD.split}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    placeholder="0"
                    value={split}
                    onChange={(e) => setSplit(e.target.value)}
                    className={cls(styles.input, errors.split && styles.bad)}
                    {...invalidProps(`${FIELD.split}-error`, errors.split)}
                  />
                  <div className={styles.presetRow}>
                    {SPLIT_PRESETS.map((p) => (
                      <button
                        key={p.percent}
                        type="button"
                        className={styles.presetBtn}
                        onClick={() => setSplit(String(p.percent))}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <ErrorText id={`${FIELD.split}-error`} text={errors.split} />
                </div>

                <label className={cls(styles.field, styles.wide)}>
                  <span className={styles.label}>Brief</span>
                  <textarea
                    name={FIELD.brief}
                    rows={2}
                    maxLength={280}
                    className={cls(styles.input, styles.textarea, errors.brief && styles.bad)}
                    {...invalidProps(`${FIELD.brief}-error`, errors.brief)}
                  />
                  <ErrorText id={`${FIELD.brief}-error`} text={errors.brief} />
                </label>
              </div>

              <label className={styles.check}>
                <input type="checkbox" name={FIELD.hold} defaultChecked />
                Hold the room for this night
              </label>
            </section>
          )}

          <section>
            <SectionHeading>Anything else</SectionHeading>
            <label className={styles.field}>
              <span className={styles.label}>
                {external ? 'Anything else the venue should know' : 'Note'}
              </span>
              <textarea
                name={FIELD.note}
                rows={3}
                maxLength={1000}
                className={cls(styles.input, styles.textarea, errors.note && styles.bad)}
                {...invalidProps(`${FIELD.note}-error`, errors.note)}
              />
              <ErrorText id={`${FIELD.note}-error`} text={errors.note} />
            </label>

            {external ? (
              <>
                <div className={styles.grid}>
                  <label className={styles.field}>
                    <span className={styles.label}>Alternate date</span>
                    <input
                      type="date"
                      name={FIELD.alt1}
                      min={today}
                      className={cls(styles.input, errors.alternates && styles.bad)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Second alternate date</span>
                    <input
                      type="date"
                      name={FIELD.alt2}
                      min={today}
                      className={cls(styles.input, errors.alternates && styles.bad)}
                    />
                  </label>
                </div>
                <ErrorText id="alternates-error" text={errors.alternates} />
              </>
            ) : null}
          </section>
        </div>

        <ModelPanel inputs={modelInputs} external={external} />

        <div className={styles.footer}>
          <button type="submit" className={styles.submit} disabled={pending || started}>
            {pending || started
              ? external
                ? 'Sending…'
                : 'Starting…'
              : external
                ? 'Send it to the venue'
                : 'Start the enquiry'}
          </button>
        </div>
      </form>
    </>
  )
}
