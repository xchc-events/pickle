'use client'

import { FileUpload, type BeginResponse } from '@/components/FileUpload'
import type { Said } from '@/lib/toast'
import styles from './grant.module.css'

/**
 * The upload slots an act sees.
 *
 * One slot per thing the crew actually needs, each labelled with what it is
 * for rather than with its file type. An artist knows what a stage plot is;
 * they do not know what `STAGE_PLOT` is, and they should not have to pick a
 * category out of a list to work out where their PDF goes.
 */

const SLOTS = [
  {
    kind: 'RIDER_TECH',
    label: 'Tech rider',
    hint: 'Backline, inputs, monitoring — whatever you send every venue.',
    accept: '.pdf,.doc,.docx,.txt,image/*',
  },
  {
    kind: 'STAGE_PLOT',
    label: 'Stage plot',
    hint: 'A drawing is fine. A photo of a drawing is fine too.',
    accept: '.pdf,image/*',
  },
  {
    kind: 'RIDER_HOSPITALITY',
    label: 'Hospitality rider',
    hint: 'Food, drink, anything the green room needs to know. Optional.',
    accept: '.pdf,.doc,.docx,.txt',
  },
  {
    kind: 'PRESS_SHOT',
    label: 'Press shot',
    hint: 'One good photo. It ends up on the event page and the listings.',
    accept: 'image/*',
  },
] as const

export interface HeldFile {
  id: string
  name: string
  kind: string
  at: string
}

export function GrantUploads({
  begin,
  finish,
  held,
}: {
  begin: (kind: string, name: string, mime: string, size: number) => Promise<BeginResponse>
  finish: (fileId: string) => Promise<Said>
  held: HeldFile[]
}) {
  return (
    <div className={styles.slots}>
      {SLOTS.map((slot) => {
        const already = held.filter((h) => h.kind === slot.kind)
        return (
          <div key={slot.kind} className={styles.slot}>
            <div className={styles.slotHead}>
              <span className={styles.slotLabel}>{slot.label}</span>
              {already.length ? (
                <span className={styles.slotHas}>
                  <i className="ph ph-check-circle" aria-hidden="true" />
                  {already[0]!.name}
                </span>
              ) : null}
            </div>

            <FileUpload
              accept={slot.accept}
              label={already.length ? 'Replace it' : 'Choose a file'}
              hint={slot.hint}
              begin={(name, mime, size) => begin(slot.kind, name, mime, size)}
              finish={finish}
            />
          </div>
        )
      })}
    </div>
  )
}
