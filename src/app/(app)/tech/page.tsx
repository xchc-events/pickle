import Link from 'next/link'
import { requireModule } from '@/lib/permissions'
import { loadTech, TECH_SET } from '@/lib/tech-data'
import { isConfigured } from '@/lib/r2'
import { SectionHeading } from '@/components/SectionHeading'
import { FileUpload } from '@/components/FileUpload'
import { OpenFile } from './FileRowActions'
import { ArtistLink } from './ArtistLink'
import {
  beginTechUpload,
  finishTechUpload,
  issueArtistLink,
  linkArtistToPayee,
  linkToFile,
} from './actions'
import styles from './tech.module.css'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

const KB = 1024
const size = (bytes: number) =>
  bytes < KB * KB ? `${Math.round(bytes / KB)} KB` : `${(bytes / (KB * KB)).toFixed(1)} MB`

const NAME_OF = Object.fromEntries(TECH_SET.map((s) => [s.kind, s.name]))

export default async function TechPage({ searchParams }: PageProps<'/tech'>) {
  const { user } = await requireModule('tech')

  const sp = await searchParams
  const { queue, event, storageReady } = await loadTech(user, one(sp.event), isConfigured())

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Tech production</h1>
          <p className={styles.sub}>
            <span className={styles.kicker}>the Rig</span> · riders arrive from the act, not from an
            inbox · nothing here was forwarded twice
          </p>
        </div>
      </header>

      {!storageReady ? (
        <p className={styles.notReady}>
          <i className="ph ph-warning" aria-hidden="true" />
          File storage is not configured on this install, so nothing can be uploaded yet. Everything
          else on this page works. Set the R2 keys in <code>.env</code> — see the README.
        </p>
      ) : null}

      <div className={styles.queue}>
        {queue.map((q) => (
          <Link
            key={q.id}
            href={`/tech?event=${q.id}`}
            className={`${styles.queueItem} ${event?.id === q.id ? styles.queueOn : ''}`}
          >
            <span className={styles.queueName}>{q.name}</span>
            <span className={styles.queueDate}>{q.date}</span>
            <span className={`${styles.queueNote} ${styles[q.tone]}`}>
              {q.have}/{q.need} · {q.note}
            </span>
          </Link>
        ))}
      </div>

      {event === null ? (
        <p className={styles.empty}>
          Nothing is past Confirmed. Tech starts when terms do — rigging an event that has not been
          agreed is work done on a show that may never happen.
        </p>
      ) : (
        <div className={styles.body}>
          <div className={styles.eventHead}>
            <h2 className={styles.eventName}>{event.name}</h2>
            <span className={styles.eventMeta}>
              {event.date} · {event.spaceName} · {event.format}
            </span>
          </div>

          <SectionHeading note="what the crew needs before the day">On this event</SectionHeading>

          {event.files.length === 0 ? (
            <p className={styles.none}>
              Nothing has arrived yet. Send the acts a link below rather than asking them to email
              it — a rider in somebody’s inbox is a rider the crew cannot see.
            </p>
          ) : (
            <ul className={styles.files}>
              {event.files.map((f) => (
                <li key={f.id} className={styles.file}>
                  <div className={styles.fileMain}>
                    <span className={styles.fileKind}>{NAME_OF[f.kind] ?? f.kind}</span>
                    <span className={styles.fileName}>{f.name}</span>
                  </div>
                  <span className={styles.fileMeta}>
                    {size(f.size)}
                    {f.version > 1 ? ` · v${f.version}` : ''}
                    {f.uploadedBy ? ` · ${f.uploadedBy}` : ' · from the act'}
                  </span>
                  <OpenFile fileId={f.id} link={linkToFile.bind(null, event.id)}>
                    Open
                  </OpenFile>
                </li>
              ))}
            </ul>
          )}

          {event.missing.length ? (
            <ul className={styles.missing}>
              {event.missing.map((m) => (
                <li key={m.kind} className={styles.missingItem}>
                  <div>
                    <span className={styles.missingName}>{m.name}</span>
                    <span className={styles.missingWhy}>{m.why}</span>
                  </div>
                  {storageReady ? (
                    <FileUpload
                      label="Add it yourself"
                      begin={beginTechUpload.bind(null, event.id, m.kind)}
                      finish={finishTechUpload.bind(null, event.id)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <SectionHeading note="one record of an act, across every booking">
            Acts and their details
          </SectionHeading>

          {event.artists.length === 0 ? (
            <p className={styles.none}>No acts on this event yet.</p>
          ) : (
            <ul className={styles.artists}>
              {event.artists.map((a) => (
                <li key={a.id} className={styles.artist}>
                  <div className={styles.artistMain}>
                    <span className={styles.artistName}>{a.name}</span>
                    <span className={styles.artistStatus}>{a.status}</span>
                  </div>

                  <div className={styles.artistDetails}>
                    <span className={a.detailsOnFile ? styles.good : styles.warn}>
                      {a.detailsOnFile ? a.account : 'no bank details on file'}
                    </span>
                    {a.openGrant ? (
                      <span className={styles.artistNote}>a link is already out with them</span>
                    ) : null}
                  </div>

                  <ArtistLink
                    hasPayee={a.payeeId !== null}
                    issue={issueArtistLink.bind(null, event.id, a.id)}
                    link={linkArtistToPayee.bind(null, event.id, a.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
