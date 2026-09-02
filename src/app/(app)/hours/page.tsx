import Link from 'next/link'
import { requireModule } from '@/lib/permissions'
import { loadHours } from '@/lib/hours-data'
import { SectionHeading } from '@/components/SectionHeading'
import { Avatar } from '@/components/Avatar'
import { ActionButton } from '@/components/ActionButton'
import { LogHours } from './LogHours'
import { logHours, removeEntry } from './actions'
import styles from './hours.module.css'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/**
 * Hours.
 *
 * The claim the product has to keep is one record of an hour, and this is
 * where it is visible: the on-site column comes from the roster, not from
 * anybody retyping it, and the same rows feed the wage line in Finance. The
 * timesheet and the roster cannot disagree because there is only one table.
 */
export default async function HoursPage({ searchParams }: PageProps<'/hours'>) {
  const { user } = await requireModule('hours')

  const sp = await searchParams
  const data = await loadHours(user, one(sp.who))

  return (
    <div>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Hours</h1>
          <p className={styles.sub}>
            <span className={styles.kicker}>the Ledger</span> · one record of an hour · the roster
            writes the on-site ones, nobody types them twice
          </p>
        </div>
      </header>

      <div className={styles.tiles}>
        {data.tiles.map((t) => (
          <div key={t.label} className={styles.tile}>
            <span className={styles.tileLabel}>{t.label}</span>
            <span className={`${styles.tileValue} ${t.accent ? styles.accent : ''} tabular`}>
              {t.value}
            </span>
            <span className={styles.tileSub}>{t.sub}</span>
          </div>
        ))}
      </div>

      <div className={styles.body}>
        <SectionHeading note="before you commit it, not after">Log your time</SectionHeading>

        <LogHours
          canLog={user.personId !== null}
          events={data.eventOptions}
          months={data.monthOptions}
          log={logHours}
        />

        <SectionHeading note={`${data.mineTotal} · ${data.mineCost}`}>
          {data.who?.isMe ? 'Your lines' : `${data.who?.name ?? 'Their'} lines`}
        </SectionHeading>

        {data.mine.length === 0 ? (
          <p className={styles.none}>
            Nothing logged. Rostered shifts appear here on their own once they are assigned — this
            list is only what has not come off the roster.
          </p>
        ) : (
          <ul className={styles.lines}>
            {data.mine.map((l) => (
              <li key={l.id} className={styles.line}>
                <div className={styles.lineMain}>
                  <span className={styles.lineRole}>{l.role}</span>
                  {l.note ? <span className={styles.lineNote}>{l.note}</span> : null}
                </div>
                <span className={`${styles.lineWhere} ${styles[l.kind]}`}>{l.where}</span>
                <span className={styles.lineWhen}>{l.when}</span>
                <span className={`${styles.lineHours} tabular`}>{l.hoursLabel}</span>
                <span className={`${styles.lineCost} tabular`}>{l.cost}</span>

                {l.fromRoster ? (
                  <span
                    className={styles.fromRoster}
                    title="Written by the roster when the shift was assigned"
                  >
                    <i className="ph ph-users-three" aria-hidden="true" />
                    rostered
                  </span>
                ) : data.who?.isMe ? (
                  <ActionButton
                    className={styles.remove}
                    action={removeEntry.bind(null, l.id)}
                    title="Remove this entry"
                  >
                    <i className="ph ph-x" aria-hidden="true" />
                  </ActionButton>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}

        <SectionHeading note="pooled by month, spread across that month's events">
          Org-wide labour
        </SectionHeading>

        <ul className={styles.months}>
          {data.months.map((m) => (
            <li key={m.key} className={styles.month}>
              <div className={styles.monthHead}>
                <span className={styles.monthLabel}>{m.label}</span>
                <span className={styles.monthFigures}>
                  <span className="tabular">{m.orgHoursLabel}</span>
                  <span className={styles.monthCost}>{m.orgCost}</span>
                </span>
              </div>
              <div className={styles.track}>
                <div className={styles.fill} style={{ width: `${m.width}%` }} />
              </div>
              <div className={styles.monthFoot}>
                <span className={styles.monthRoles}>{m.roles}</span>
                <span className={m.events === 0 ? styles.warn : styles.monthPer}>
                  {m.events === 0
                    ? 'no events that month — nothing to carry it'
                    : `${m.events} ${m.events === 1 ? 'event' : 'events'} · ${m.perEvent} each`}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <SectionHeading note="on site comes from the roster">Where the hours went</SectionHeading>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Event</th>
                <th>On site</th>
                <th>Off site</th>
                <th>Org share</th>
                <th>Total</th>
                <th>Loaded</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className={styles.evName}>{e.name}</span>
                    <span className={styles.evDate}>{e.date}</span>
                  </td>
                  <td className="tabular">{e.onSite}</td>
                  <td className="tabular">{e.offSite}</td>
                  <td className="tabular">{e.org}</td>
                  <td className={`${styles.evTotal} tabular`}>{e.total}</td>
                  <td className={`${e.heavy ? styles.warn : ''} tabular`}>{e.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <SectionHeading note="rostered plus logged">Who is carrying it</SectionHeading>

        <ul className={styles.people}>
          {data.people.map((p) => (
            <li key={p.personId} className={`${styles.person} ${p.isMe ? styles.personOn : ''}`}>
              <Avatar initials={p.initials} title={p.name} accent={p.isMe} />
              <Link href={`/hours?who=${p.personId}`} className={styles.personName}>
                {p.name}
              </Link>
              <div className={styles.track}>
                <div className={styles.fill} style={{ width: `${p.width}%` }} />
              </div>
              <span className="tabular">{p.hoursLabel}</span>
              <span className={`${styles.personCost} tabular`}>{p.cost}</span>
            </li>
          ))}
        </ul>

        <p className={styles.footnote}>
          Every figure on this page is the same rows the wage line in Finance reads. There is no
          second timesheet to reconcile — the roster writes here directly, so a shift that moved and
          an hour that moved are the same event.
        </p>
      </div>
    </div>
  )
}
