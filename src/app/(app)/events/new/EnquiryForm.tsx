'use client'

import { useRef, useState, useTransition, type ChangeEvent, type FormEvent } from 'react'
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
import { CLOSE_TIMES, DOOR_TIMES, OUT_TIMES } from '@/lib/event-record'
import { capacityOf } from '@/lib/ticketing'
import { startEnquiry } from './actions'
import styles from './new.module.css'

/**
 * The one form both a coordinator and an outside promoter fill in.
 *
 * They are not the same form wearing a disguise: an outside account's raw
 * input is whitelisted server-side in `cleanEnquiry` (src/lib/intake.ts) and
 * re-derived from the session in `createEnquiry`, whatever this component
 * sends — so a field absent here is belt, and the server is braces. Fields
 * that are only ever the venue's decision (owner, split, attendance, money,
 * the model, act fees) are missing from the DOM entirely for an outside
 * account, not merely hidden, per the house rule that permission is never a
 * CSS concern.
 *
 * React 19 clears every uncontrolled field once a function `action` commits —
 * including on a *failed* submit, which would wipe out everything a person
 * just typed the moment the server hands back errors. So this form is a plain
 * `onSubmit` that calls `preventDefault` and reads `FormData` from the live
 * DOM itself, inside the transition, rather than an `action` prop. Nothing
 * here resets the form on failure; a person only loses what they typed by
 * choosing to change it.
 */

const cls = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

/** Which control to focus for each field, walking `FIELD_ORDER` after a
 *  failed submit. A group field (an act row, the attendance spread) points at
 *  its first input. */
const FOCUS_NAME: Record<FieldKey, string> = {
  name: FIELD.name,
  date: FIELD.date,
  spaceId: FIELD.spaceId,
  kind: FIELD.kind,
  format: FIELD.format,
  doors: FIELD.doors,
  barClose: FIELD.barClose,
  allOut: FIELD.allOut,
  acts: FIELD.actName,
  note: FIELD.note,
  ownerId: FIELD.ownerId,
  model: FIELD.model,
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

function ActRow({
  index,
  external,
  onRemove,
}: {
  index: number
  external: boolean
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
        <>
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
          <label className={styles.field}>
            <span className={styles.label}>Fee floor</span>
            <input
              name={FIELD.actLow}
              type="number"
              inputMode="decimal"
              placeholder="0"
              className={styles.input}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Fee ceiling</span>
            <input
              name={FIELD.actHigh}
              type="number"
              inputMode="decimal"
              placeholder="0"
              className={styles.input}
            />
          </label>
        </>
      )}
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

  // Room and format drive both each other's options and the attendance
  // prefill, so both are tracked here even though most fields are left
  // uncontrolled (see the file comment).
  const initialFormat = FORMAT_FOR_KIND[KINDS[0].value]
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? '')
  const [format, setFormat] = useState<Format>(initialFormat)
  const [att, setAtt] = useState<[string, string, string]>(() =>
    computeAtt(spaces[0] ?? null, initialFormat),
  )
  // Once a person has typed into any of the three attendance inputs, a room
  // or format change must stop overwriting them — see spec §6.
  const [attEdited, setAttEdited] = useState(false)

  const [bringing, setBringing] = useState<'venue' | 'organisation' | 'name'>(
    organisations.length > 0 ? 'organisation' : 'venue',
  )

  const [actRows, setActRows] = useState<number[]>([0, 1])
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
    const nextFormat = FORMAT_FOR_KIND[e.target.value as Kind]
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
    setActRows((rows) => (rows.length >= MAX_ACTS ? rows : [...rows, nextActRowId.current++]))
  }

  function removeActRow(id: number) {
    setActRows((rows) => rows.filter((r) => r !== id))
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
                className={cls(styles.input, errors.date && styles.bad)}
                {...invalidProps(`${FIELD.date}-error`, errors.date)}
              />
              <ErrorText id={`${FIELD.date}-error`} text={errors.date} />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Room</span>
              <select
                name={FIELD.spaceId}
                defaultValue={spaceId}
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
              <span className={styles.label}>Kind</span>
              <select
                name={FIELD.kind}
                defaultValue={KINDS[0].value}
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
          <SectionHeading note="leave any of these as not decided until you know">
            Doors, bar and close
          </SectionHeading>
          <div className={styles.grid}>
            <label className={styles.field}>
              <span className={styles.label}>Doors open</span>
              <select
                name={FIELD.doors}
                defaultValue=""
                className={cls(styles.input, errors.doors && styles.bad)}
                {...invalidProps(`${FIELD.doors}-error`, errors.doors)}
              >
                <option value="">Not decided</option>
                {DOOR_TIMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <ErrorText id={`${FIELD.doors}-error`} text={errors.doors} />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Bar closes</span>
              <select
                name={FIELD.barClose}
                defaultValue=""
                className={cls(styles.input, errors.barClose && styles.bad)}
                {...invalidProps(`${FIELD.barClose}-error`, errors.barClose)}
              >
                <option value="">Not decided</option>
                {CLOSE_TIMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <ErrorText id={`${FIELD.barClose}-error`} text={errors.barClose} />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Everyone out</span>
              <select
                name={FIELD.allOut}
                defaultValue=""
                className={cls(styles.input, errors.allOut && styles.bad)}
                {...invalidProps(`${FIELD.allOut}-error`, errors.allOut)}
              >
                <option value="">Not decided</option>
                {OUT_TIMES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <ErrorText id={`${FIELD.allOut}-error`} text={errors.allOut} />
            </label>
          </div>
        </section>

        {external ? null : (
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
                <select name={FIELD.ownerId} defaultValue={defaultOwnerId} className={styles.input}>
                  <option value="">Nobody yet</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Booking model</span>
                <select name={FIELD.model} defaultValue="curator" className={styles.input}>
                  {MODELS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        )}

        <section>
          <SectionHeading note={`up to ${MAX_ACTS} — more go in the note below`}>
            The acts
          </SectionHeading>
          <div className={styles.acts}>
            {actRows.map((id, index) => (
              <ActRow
                key={id}
                index={index}
                external={external}
                onRemove={() => removeActRow(id)}
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

        {external ? null : (
          <section>
            <SectionHeading note="house starting points · ticket prices are set in Ticketing">
              The deal and the model
            </SectionHeading>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span className={styles.label}>Split %</span>
                <input
                  name={FIELD.split}
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  className={cls(styles.input, errors.split && styles.bad)}
                  {...invalidProps(`${FIELD.split}-error`, errors.split)}
                />
                <ErrorText id={`${FIELD.split}-error`} text={errors.split} />
              </label>

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

              <label className={styles.field}>
                <span className={styles.label}>Bar spend per head</span>
                <input
                  name={FIELD.barHead}
                  type="number"
                  inputMode="decimal"
                  defaultValue={HOUSE_STARTING_POINTS.barHead}
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
                  defaultValue={HOUSE_STARTING_POINTS.gear}
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
                  defaultValue={HOUSE_STARTING_POINTS.adv}
                  className={cls(styles.input, errors.adv && styles.bad)}
                  {...invalidProps(`${FIELD.adv}-error`, errors.adv)}
                />
                <ErrorText id={`${FIELD.adv}-error`} text={errors.adv} />
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Sound</span>
                <select
                  name={FIELD.sound}
                  defaultValue={HOUSE_STARTING_POINTS.sound}
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
                  defaultValue={HOUSE_STARTING_POINTS.crew}
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
                  defaultValue={HOUSE_STARTING_POINTS.tok}
                  className={cls(styles.input, errors.tok && styles.bad)}
                  {...invalidProps(`${FIELD.tok}-error`, errors.tok)}
                />
                <ErrorText id={`${FIELD.tok}-error`} text={errors.tok} />
              </label>

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
          </section>
        )}

        <section>
          <SectionHeading>Anything else</SectionHeading>
          <label className={styles.field}>
            <span className={styles.label}>
              {external
                ? 'Other dates that would work, and anything else the venue should know'
                : 'Note'}
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
        </section>

        {external ? null : (
          <label className={styles.check}>
            <input type="checkbox" name={FIELD.hold} defaultChecked />
            Hold the room for this night
          </label>
        )}

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
