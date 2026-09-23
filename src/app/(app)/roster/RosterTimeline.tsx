'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useToast } from '@/components/Toast'
import type { Said } from '@/lib/toast'
import {
  buildRosterTimeline,
  clampEdges,
  clockLabelForOffset,
  fractionForOffset,
  hoursToClockInput,
  snapQuarterHour,
  type TimelineBar,
} from '@/lib/roster-timeline'
import styles from './roster.module.css'

/**
 * The night as a timeline, above the shift list — a day view with drag.
 *
 * Connor, 23 Sep 2026: "To see in a more visual way what period of time
 * each person is going to be on site. It would be nice to just click and
 * drag to move the beginning and end times of those shifts around,
 * something very similar to the Google Calendar day or week view."
 *
 * All the geometry — the axis, the five run-time marks, each bar's
 * position as a fraction, 15-minute snapping — is `src/lib/roster-timeline.ts`,
 * a pure function this component only draws from and re-runs live against
 * the pointer while a drag is in progress. The list below is unchanged and
 * stays the way to edit on a phone; this is a second way to call the same
 * `retimeShift` action, not a replacement for it.
 */

export interface RosterTimelineShift {
  id: string
  role: string
  /** Hours offset from doors — the same unit as `Shift.start`. */
  start: number
  hours: number
  state: string
  personInitials: string | null
  /** Bound server action, e.g. `retimeShift.bind(null, event.id, s.id)` —
   *  the exact function `ShiftEditor`'s own `retime` prop is. */
  retime: (input: { start: string; end: string }) => Promise<Said>
}

type DragMode = 'start' | 'end' | 'move'

interface DragState {
  id: string
  mode: DragMode
  pointerId: number
  pointerStartX: number
  trackWidthPx: number
  originStart: number
  originEnd: number
  liveStart: number
  liveEnd: number
}

/** 15 minutes — the drag snap and the keyboard nudge, alike. */
const STEP_HOURS = 0.25

export function RosterTimeline({
  packIn,
  doors,
  barClose,
  allOut,
  packOut,
  shifts,
}: {
  packIn: string | null
  doors: string | null
  barClose: string | null
  allOut: string | null
  packOut: string | null
  shifts: RosterTimelineShift[]
}) {
  const say = useToast()
  const [pending, startTransition] = useTransition()
  const [drag, setDrag] = useState<DragState | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const timeline = useMemo(
    () =>
      buildRosterTimeline(
        { packIn, doors, barClose, allOut, packOut },
        shifts.map((s) => ({
          id: s.id,
          role: s.role,
          start: s.start,
          hours: s.hours,
          state: s.state,
          personInitials: s.personInitials,
        })),
      ),
    [packIn, doors, barClose, allOut, packOut, shifts],
  )

  const byId = useMemo(() => new Map(shifts.map((s) => [s.id, s] as const)), [shifts])

  function commit(id: string, startHours: number, endHours: number) {
    const shift = byId.get(id)
    if (!shift) {
      setDrag(null)
      return
    }
    const startInput = hoursToClockInput(doors, startHours)
    const endInput = hoursToClockInput(doors, endHours)
    if (!startInput || !endInput) {
      // Doors is not decided yet — the same case retimeShift itself refuses
      // on ("Set doors on the event before editing shift times."), so there
      // is nothing sane to send; just let the bar spring back.
      setDrag(null)
      return
    }
    startTransition(async () => {
      const out = await shift.retime({ start: startInput, end: endInput })
      setDrag(null)
      say(out)
    })
  }

  function beginDrag(e: ReactPointerEvent<HTMLElement>, bar: TimelineBar, mode: DragMode) {
    if (pending) return
    const track = trackRef.current
    if (!track) return
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({
      id: bar.id,
      mode,
      pointerId: e.pointerId,
      pointerStartX: e.clientX,
      trackWidthPx: track.getBoundingClientRect().width,
      originStart: bar.startHours,
      originEnd: bar.endHours,
      liveStart: bar.startHours,
      liveEnd: bar.endHours,
    })
  }

  function onDragMove(e: ReactPointerEvent<HTMLElement>) {
    if (!drag || e.pointerId !== drag.pointerId || drag.trackWidthPx <= 0) return
    const span = timeline.axisEnd - timeline.axisStart
    const deltaHours = ((e.clientX - drag.pointerStartX) / drag.trackWidthPx) * span

    let liveStart = drag.originStart
    let liveEnd = drag.originEnd
    if (drag.mode === 'start') {
      liveStart = snapQuarterHour(drag.originStart + deltaHours)
    } else if (drag.mode === 'end') {
      liveEnd = snapQuarterHour(drag.originEnd + deltaHours)
    } else {
      const snappedStart = snapQuarterHour(drag.originStart + deltaHours)
      const moved = snappedStart - drag.originStart
      liveStart = snappedStart
      liveEnd = drag.originEnd + moved
    }

    const clamped = clampEdges(liveStart, liveEnd)
    setDrag({ ...drag, liveStart: clamped.start, liveEnd: clamped.end })
  }

  function endDrag(e: ReactPointerEvent<HTMLElement>) {
    if (!drag || e.pointerId !== drag.pointerId) return
    commit(drag.id, drag.liveStart, drag.liveEnd)
  }

  function onHandleKeyDown(
    e: ReactKeyboardEvent<HTMLElement>,
    bar: TimelineBar,
    edge: 'start' | 'end',
  ) {
    if (pending) return
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const delta = (e.key === 'ArrowRight' ? 1 : -1) * STEP_HOURS
    const next =
      edge === 'start'
        ? clampEdges(snapQuarterHour(bar.startHours + delta), bar.endHours)
        : clampEdges(bar.startHours, snapQuarterHour(bar.endHours + delta))
    commit(bar.id, next.start, next.end)
  }

  return (
    <div className={styles.timeline} role="group" aria-label="Shift timeline">
      <div className={styles.timelineScroll}>
        <div className={styles.timelineBody}>
          <div className={styles.timelineTicksRow}>
            <div className={styles.timelineTicksSpacer} aria-hidden="true" />
            <div className={styles.timelineTicksTrack} ref={trackRef}>
              {timeline.ticks.map((t) => (
                <span
                  key={t.hours}
                  className={styles.timelineTick}
                  style={{ left: `${t.fraction * 100}%` }}
                >
                  <span className={styles.timelineTickLabel}>{t.label}</span>
                </span>
              ))}
            </div>
          </div>

          <div className={styles.timelineMarks} aria-hidden="true">
            {timeline.marks.map((m) => (
              <span
                key={m.key}
                className={styles.timelineMark}
                style={{ left: `${m.fraction * 100}%` }}
              >
                <span className={styles.timelineMarkLabel}>{m.label}</span>
              </span>
            ))}
          </div>

          <div className={`${styles.timelineRows} ${pending ? styles.timelineRowsPending : ''}`}>
            {timeline.bars.map((bar) => {
              const isDragging = drag?.id === bar.id
              const startFraction = isDragging
                ? fractionForOffset(drag.liveStart, timeline.axisStart, timeline.axisEnd)
                : bar.startFraction
              const endFraction = isDragging
                ? fractionForOffset(drag.liveEnd, timeline.axisStart, timeline.axisEnd)
                : bar.endFraction
              const startHours = isDragging ? drag.liveStart : bar.startHours
              const endHours = isDragging ? drag.liveEnd : bar.endHours
              const toneClass =
                bar.tone === 'open'
                  ? styles.timelineBar_open
                  : bar.tone === 'offered'
                    ? styles.timelineBar_offered
                    : styles.timelineBar_covered

              return (
                <div key={bar.id} className={styles.timelineRow}>
                  <span className={styles.timelineRowLabel}>{bar.role}</span>
                  <div className={styles.timelineRowTrack}>
                    <div
                      className={`${styles.timelineBar} ${toneClass} ${isDragging ? styles.timelineBarDragging : ''}`}
                      style={{
                        left: `${startFraction * 100}%`,
                        width: `${Math.max(0, endFraction - startFraction) * 100}%`,
                      }}
                      onPointerDown={(e) => beginDrag(e, bar, 'move')}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      title={`${bar.role}: drag to move`}
                    >
                      <span
                        role="slider"
                        tabIndex={0}
                        className={styles.timelineHandleStart}
                        aria-label={`${bar.role} start time`}
                        aria-orientation="horizontal"
                        aria-valuemin={timeline.axisStart}
                        aria-valuemax={endHours}
                        aria-valuenow={startHours}
                        aria-valuetext={clockLabelForOffset(doors, startHours) || undefined}
                        onPointerDown={(e) => beginDrag(e, bar, 'start')}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onKeyDown={(e) => onHandleKeyDown(e, bar, 'start')}
                      />
                      <span className={styles.timelineBarLabel}>{bar.label}</span>
                      <span
                        role="slider"
                        tabIndex={0}
                        className={styles.timelineHandleEnd}
                        aria-label={`${bar.role} end time`}
                        aria-orientation="horizontal"
                        aria-valuemin={startHours}
                        aria-valuemax={timeline.axisEnd}
                        aria-valuenow={endHours}
                        aria-valuetext={clockLabelForOffset(doors, endHours) || undefined}
                        onPointerDown={(e) => beginDrag(e, bar, 'end')}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        onKeyDown={(e) => onHandleKeyDown(e, bar, 'end')}
                      />
                    </div>
                  </div>
                  {isDragging ? (
                    <span className={styles.timelineLiveLabel}>
                      {clockLabelForOffset(doors, drag.liveStart)}–
                      {clockLabelForOffset(doors, drag.liveEnd)}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {timeline.bars.length === 0 ? (
        <p className={styles.timelineEmpty}>Nobody on the timeline yet.</p>
      ) : null}
    </div>
  )
}
