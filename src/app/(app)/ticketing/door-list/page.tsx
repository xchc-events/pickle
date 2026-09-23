import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireEvent, requireModule } from '@/lib/permissions'
import { loadDoorListPrint } from '@/lib/ticketing-data'
import { PrintButton } from './PrintButton'
import styles from './door-list.module.css'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * The door list's print view — T7, `/ticketing/door-list?event=…`.
 *
 * Plain and printable: one heading, the list grouped by kind, a running
 * total, nothing else. This route still lives under the signed-in app —
 * `(app)/layout.tsx` draws its sidebar and top bar around every page below
 * it, and a nested layout cannot opt out of an ancestor's — so the inline
 * style below hides everything outside this page's own content when it is
 * printed, rather than fighting that structure. Venue only, the same as the
 * Door list section it links from.
 */
export default async function DoorListPrintPage({
  searchParams,
}: PageProps<'/ticketing/door-list'>) {
  const { user } = await requireModule('ticketing')
  if (user.external) notFound()

  const sp = await searchParams
  const eventId = one(sp.event)
  if (!eventId) notFound()

  const id = await requireEvent(user, eventId)
  const data = await loadDoorListPrint(id)

  return (
    <div id="door-list-print" className={styles.page}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #door-list-print, #door-list-print * { visibility: visible; }
          #door-list-print { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>

      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Door list</h1>
          <p className={styles.meta}>
            {data.eventName} · {data.eventDate}
          </p>
        </div>
        <div className={styles.headActions}>
          <PrintButton className={`btn btn-secondary ${styles.printButton}`} />
          <Link href={`/ticketing?event=${id}`} className={styles.backLink}>
            Back to Ticketing
          </Link>
        </div>
      </div>

      <p className={styles.total}>{data.totalPeople} people on the list</p>

      {data.groups.length ? (
        data.groups.map((g) => (
          <section key={g.kind} className={styles.group}>
            <h2 className={styles.groupTitle}>
              {g.label} <span className={styles.groupCount}>· {g.people}</span>
            </h2>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Name</th>
                  <th className={styles.thNarrow}>Party</th>
                  <th className={styles.th}>Note</th>
                  <th className={styles.thTick} aria-label="Checked in">
                    ✓
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <td className={styles.td}>{r.name}</td>
                    <td className={styles.tdNarrow}>{r.partySize}</td>
                    <td className={styles.td}>{r.note ?? ''}</td>
                    <td className={styles.tdTick} />
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      ) : (
        <p className={styles.empty}>No one on the list yet.</p>
      )}
    </div>
  )
}
