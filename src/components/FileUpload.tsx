'use client'

import { useRef, useState } from 'react'
import type { Said } from '@/lib/toast'
import { useToast } from './Toast'
import styles from './FileUpload.module.css'

/**
 * Picking a file and getting it into the bucket.
 *
 * Three steps, because the bytes do not come through the application:
 *
 *   1. `begin` — the server checks what we say we are sending and hands back
 *      a URL to put it at.
 *   2. the browser PUTs it straight to R2.
 *   3. `finish` — the server asks R2 what it actually received.
 *
 * The progress bar is not decoration. A tech rider is a moment and a print
 * PDF is a minute or more on a venue connection, and an upload with no
 * feedback is one a person cancels halfway.
 */

export interface BeginResponse {
  ok: boolean
  fileId?: string
  url?: string
  why?: string
}

export function FileUpload({
  begin,
  finish,
  accept,
  label = 'Add a file',
  hint,
}: {
  begin: (name: string, mime: string, size: number) => Promise<BeginResponse>
  finish: (fileId: string) => Promise<Said>
  /** The `accept` attribute. A convenience — the server decides for real. */
  accept?: string
  label?: string
  hint?: string
}) {
  const say = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [pct, setPct] = useState<number | null>(null)

  async function send(file: File) {
    setPct(0)

    const started = await begin(file.name, file.type || 'application/octet-stream', file.size)
    if (!started.ok || !started.url || !started.fileId) {
      setPct(null)
      say({ kind: 'stop', text: started.why ?? 'That file was not accepted.' })
      return
    }

    try {
      await put(started.url, file, setPct)
    } catch {
      setPct(null)
      say({ kind: 'stop', text: 'The upload did not finish. Check the connection and try again.' })
      return
    }

    // The server now asks R2 what it actually holds. Until this returns, the
    // file exists in the bucket but not in the product.
    const said = await finish(started.fileId)
    setPct(null)
    say(said)
  }

  return (
    <div className={styles.wrap}>
      <input
        ref={input}
        type="file"
        accept={accept}
        className={styles.input}
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Cleared so choosing the same file twice still fires a change.
          e.target.value = ''
          if (file) void send(file)
        }}
      />

      <button
        type="button"
        className={styles.button}
        disabled={pct !== null}
        onClick={() => input.current?.click()}
      >
        <i className="ph ph-upload-simple" aria-hidden="true" />
        {pct === null ? label : `Sending… ${pct}%`}
      </button>

      {pct !== null ? (
        <div className={styles.track} role="progressbar" aria-valuenow={pct}>
          <div className={styles.bar} style={{ width: `${pct}%` }} />
        </div>
      ) : null}

      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  )
}

/**
 * PUT the bytes, reporting progress.
 *
 * XMLHttpRequest rather than fetch: fetch cannot report upload progress in
 * any browser we support, and for a 300MB poster that is the difference
 * between a working form and one people abandon.
 */
function put(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    })

    xhr.addEventListener('load', () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(String(xhr.status))),
    )
    xhr.addEventListener('error', () => reject(new Error('network')))
    xhr.addEventListener('abort', () => reject(new Error('aborted')))

    xhr.send(file)
  })
}
