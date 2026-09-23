import Link from 'next/link'
import { requireModule } from '@/lib/permissions'
import { loadTech, TECH_SET } from '@/lib/tech-data'
import { isConfigured } from '@/lib/r2'
import { SectionHeading } from '@/components/SectionHeading'
import { OpenFile } from './FileRowActions'
import { FileSlot } from './FileSlot'
import { AttachFile } from './AttachFile'
import {
  assignFileToArtist,
  beginPromoterUpload,
  beginTechUpload,
  finishTechUpload,
  linkToFile,
} from './actions'
import styles from './tech.module.css'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

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
            riders arrive from the act, not from an inbox · nothing here was forwarded twice
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

          <SectionHeading note="tech rider and stage plot, one slot each per act">Acts</SectionHeading>

          {event.acts.length === 0 ? (
            <p className={styles.none}>No live act on this event yet.</p>
          ) : (
            <ul className={styles.acts}>
              {event.acts.map((a) => (
                <li key={a.id} className={styles.act}>
                  <span className={styles.actName}>{a.name}</span>
                  <div className={styles.actSlots}>
                    <FileSlot
                      label="Tech rider"
                      file={a.rider}
                      storageReady={storageReady}
                      begin={beginTechUpload.bind(null, event.id, 'RIDER_TECH', a.id)}
                      finish={finishTechUpload.bind(null, event.id)}
                      link={linkToFile.bind(null, event.id)}
                    />
                    <FileSlot
                      label="Stage plot"
                      file={a.stagePlot}
                      storageReady={storageReady}
                      begin={beginTechUpload.bind(null, event.id, 'STAGE_PLOT', a.id)}
                      finish={finishTechUpload.bind(null, event.id)}
                      link={linkToFile.bind(null, event.id)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <SectionHeading note="riders and plots the promoter sends for themselves">Promoter</SectionHeading>

          {event.promoter ? (
            <ul className={styles.acts}>
              <li className={styles.act}>
                <span className={styles.actName}>{event.promoter.name}</span>
                <div className={styles.actSlots}>
                  <FileSlot
                    label="Tech rider"
                    file={event.promoter.rider}
                    storageReady={storageReady}
                    begin={beginPromoterUpload.bind(null, event.id, 'RIDER_TECH')}
                    finish={finishTechUpload.bind(null, event.id)}
                    link={linkToFile.bind(null, event.id)}
                  />
                  <FileSlot
                    label="Stage plot"
                    file={event.promoter.stagePlot}
                    storageReady={storageReady}
                    begin={beginPromoterUpload.bind(null, event.id, 'STAGE_PLOT')}
                    finish={finishTechUpload.bind(null, event.id)}
                    link={linkToFile.bind(null, event.id)}
                  />
                </div>
              </li>
            </ul>
          ) : (
            <p className={styles.none}>No promoter payee on this event to file against.</p>
          )}

          <SectionHeading note="what XCHC sends every act before they arrive">Venue spec</SectionHeading>

          <ul className={styles.acts}>
            <li className={styles.act}>
              <span className={styles.actName}>{NAME_OF.TECH_SPEC}</span>
              <div className={styles.actSlots}>
                <FileSlot
                  label={NAME_OF.TECH_SPEC}
                  file={event.venueSpec}
                  storageReady={storageReady}
                  begin={beginTechUpload.bind(null, event.id, 'TECH_SPEC', null)}
                  finish={finishTechUpload.bind(null, event.id)}
                  link={linkToFile.bind(null, event.id)}
                />
              </div>
            </li>
          </ul>

          {event.unassigned.length > 0 ? (
            <>
              <SectionHeading note="uploaded before riders were per act — say whose each one is">
                Unassigned
              </SectionHeading>
              <ul className={styles.files}>
                {event.unassigned.map((f) => (
                  <li key={f.id} className={styles.file}>
                    <div className={styles.fileMain}>
                      <span className={styles.fileKind}>{NAME_OF[f.kind] ?? f.kind}</span>
                      <span className={styles.fileName}>{f.name}</span>
                    </div>
                    <OpenFile fileId={f.id} link={linkToFile.bind(null, event.id)}>
                      Open
                    </OpenFile>
                    <AttachFile
                      acts={event.acts.map((a) => ({ id: a.id, name: a.name }))}
                      attach={assignFileToArtist.bind(null, event.id, f.id)}
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
