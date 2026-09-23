import type { FileRow } from '@/lib/files-data'
import type { Said } from '@/lib/toast'
import { FileUpload } from '@/components/FileUpload'
import { OpenFile } from './FileRowActions'
import styles from './tech.module.css'

const KB = 1024
const size = (bytes: number) =>
  bytes < KB * KB ? `${Math.round(bytes / KB)} KB` : `${(bytes / (KB * KB)).toFixed(1)} MB`

/**
 * One rider or stage plot slot, on an act's row, the promoter's row, or the
 * venue spec row. Open and version when there is a file; upload when there
 * is not; replace either way — a fresh upload supersedes rather than
 * overwrites, so "replace" is the same control as "upload", just relabelled.
 *
 * No state of its own, so no `'use client'` here — `FileUpload` and
 * `OpenFile` are already client components, and a server component can
 * render those directly.
 */
export function FileSlot({
  label,
  file,
  storageReady,
  begin,
  finish,
  link,
}: {
  label: string
  file: FileRow | null
  storageReady: boolean
  begin: (
    name: string,
    mime: string,
    size: number,
  ) => Promise<{ ok: boolean; fileId?: string; url?: string; why?: string }>
  finish: (fileId: string) => Promise<Said>
  link: (fileId: string) => Promise<string | null>
}) {
  return (
    <div className={styles.slot}>
      <span className={styles.slotLabel}>{label}</span>
      {file ? (
        <div className={styles.slotFile}>
          <span className={styles.fileName}>{file.name}</span>
          <span className={styles.fileMeta}>
            {size(file.size)}
            {file.version > 1 ? ` · v${file.version}` : ''}
            {file.uploadedBy ? ` · ${file.uploadedBy}` : ' · from the act'}
          </span>
          <div className={styles.slotActions}>
            <OpenFile fileId={file.id} link={link}>
              Open
            </OpenFile>
            {storageReady ? <FileUpload label="Replace" begin={begin} finish={finish} /> : null}
          </div>
        </div>
      ) : storageReady ? (
        <FileUpload label="Upload" begin={begin} finish={finish} />
      ) : (
        <span className={styles.slotMissing}>not yet in</span>
      )}
    </div>
  )
}
