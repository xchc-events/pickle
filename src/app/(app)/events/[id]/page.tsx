import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireModule } from '@/lib/permissions'
import { loadEventRecord } from '@/lib/event-record-data'
import { SectionHeading } from '@/components/SectionHeading'
import { Avatar } from '@/components/Avatar'
import { ActionButton } from '@/components/ActionButton'
import { LeadPicker } from '@/components/LeadPicker'
import { advanceStage, setLead } from './actions'
import { DateLock, DealPanel, LicencePicker, RunTimes } from './Controls'
import styles from './event.module.css'
import type { LeadRole } from '@/generated/prisma/client'

/**
 * The event record — the hub.
 *
 * Everything the venue knows about one night, in the order the handoff sets
 * out: the enquiry facts and what holds the event at its current stage, then
 * the licence, the bill, the terms, the labour, where it has been listed, and
 * what has happened to it.
 *
 * The gate panel is the load-bearing part. It is not a checklist for its own
 * sake — an event cannot advance while one fails, so it is the only place a
 * coordinator finds out why a show is stuck.
 *
 * Editing lives where it belongs. Ticket prices are set in Ticketing, shifts
 * in Roster, artwork in Design; this page links to them rather than growing a
 * second writer for the same field.
 */
export default async function EventPage({ params }: PageProps<'/events/[id]'>) {
  const { user } = await requireModule('pipeline')
  const { id } = await params

  // Scoped in the query. An event outside this user's reach 404s rather than
  // telling them it exists.
  const ev = await loadEventRecord(user, id)
  if (!ev) notFound()

  const people = await db.person.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })
  const leadOptions = people.map((p) => ({ personId: p.id, name: p.name }))

  const blocked = ev.gates.filter((g) => !g.ok)

  return (
    <div>
      <header className={styles.header}>
        <div className={styles.headMain}>
          <Link href="/pipeline" className={styles.back}>
            <i className="ph ph-arrow-left" aria-hidden="true" />
            Pipeline
          </Link>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{ev.name}</h1>
            <span className="tag tag-outline">{ev.stageLabel}</span>
            <span className={styles.nick}>{ev.nickname}</span>
            <span className={`tag ${ev.model === 'dry' ? 'tag-neutral' : 'tag-outline'}`}>
              {ev.modelLabel}
            </span>
          </div>
          <p className={styles.sub}>
            <span className={ev.dateTbc ? styles.warn : undefined}>
              {ev.date}
              {ev.dateTbc ? ' · date not held' : ''}
            </span>
            {' · '}
            {ev.spaceName} · {ev.promoter} ·{' '}
            {ev.concluded ? 'concluded' : `${ev.daysToDoor} to door`} · {ev.daysInStage} in stage
          </p>
        </div>

        <div className={styles.headActions}>
          <Link href={`/ticketing?event=${ev.id}`} className="btn btn-ghost">
            <i className="ph ph-ticket" aria-hidden="true" />
            Ticketing
          </Link>
          <Link href={`/design?event=${ev.id}`} className="btn btn-ghost">
            <i className="ph ph-tag" aria-hidden="true" />
            Design
          </Link>
          <Link href={`/tech?event=${ev.id}`} className="btn btn-ghost">
            <i className="ph ph-sliders" aria-hidden="true" />
            Tech
          </Link>
          {ev.concluded ? null : (
            <ActionButton
              action={advanceStage.bind(null, ev.id)}
              className={ev.canAdvance ? 'btn btn-primary' : 'btn btn-secondary'}
              title={
                ev.canAdvance
                  ? ev.advanceLabel
                  : `${blocked.length} gate${blocked.length === 1 ? '' : 's'} still to clear`
              }
            >
              {ev.advanceLabel}
            </ActionButton>
          )}
        </div>
      </header>

      <div className={styles.body}>
        {/* ---------------------------------------------------- overview --- */}
        <section id="overview">
          <SectionHeading note="who owns what, and what holds this up">
            Event overview
          </SectionHeading>

          <div className={styles.leads}>
            {ev.leads.map((l) => (
              <div key={l.role} className={styles.lead}>
                <span className={styles.leadLabel}>
                  <i className={`ph ${l.icon}`} aria-hidden="true" />
                  {l.label} lead
                </span>
                {/* Bound, not wrapped in an arrow: a closure created here is
                    an ordinary function, and a Server Component may only hand
                    a Client Component a server action itself. */}
                <LeadPicker
                  action={setLead.bind(null, ev.id, l.role.toUpperCase() as LeadRole)}
                  value={l.personId ?? ''}
                  options={leadOptions}
                  label={`${l.label} lead`}
                />
              </div>
            ))}
          </div>
          <p className={styles.note}>
            A lead is a person, not a typed-in name — renaming them in Admin renames them on every
            brief, chase and timesheet at once.
          </p>

          <div className={styles.facts}>
            {ev.facts.map((f) => (
              <div key={f.key} className={styles.fact}>
                <span className={styles.factKey}>{f.key}</span>
                <span className={styles.factValue}>{f.value}</span>
                <span className={styles.factNote}>{f.note}</span>
              </div>
            ))}
            <div className={styles.fact}>
              <span className={styles.factKey}>Owner</span>
              <span className={styles.factValue}>
                {ev.ownerName ? (
                  <>
                    <Avatar initials={ev.ownerInitials ?? '–'} title={ev.ownerName} accent />
                    {ev.ownerName}
                  </>
                ) : (
                  <span className={styles.warn}>nobody yet</span>
                )}
              </span>
              <span className={styles.factNote}>answerable for this night</span>
            </div>
            <div className={styles.fact}>
              <span className={styles.factKey}>Date</span>
              <span className={styles.factValue}>
                <DateLock eventId={ev.id} tbc={ev.dateTbc} />
              </span>
              <span className={styles.factNote}>
                {ev.dateTbc ? 'still a best guess — Enquiry holds on it' : 'held in the calendar'}
              </span>
            </div>
          </div>

          <RunTimes
            eventId={ev.id}
            doors={ev.doors}
            barClose={ev.barClose}
            allOut={ev.allOut}
            late={ev.licenceLate}
          />

          {/* The gates. */}
          <div className={styles.gates}>
            <div className={styles.gatesHead}>
              <span className={styles.gatesTitle}>{ev.gatesTitle}</span>
              <div className="rule-fade" />
              <span className={ev.canAdvance ? styles.good : styles.warn}>{ev.gatesDone}</span>
            </div>

            {ev.gates.map((g) => (
              <div key={g.label} className={`${styles.gate} ${g.ok ? styles.gateOk : ''}`}>
                <i
                  className={`ph ${g.ok ? 'ph-check-circle' : 'ph-circle-dashed'}`}
                  aria-hidden="true"
                />
                <span className={styles.gateLabel}>{g.label}</span>
                <span className={styles.gateWhy}>{g.ok ? '' : g.why}</span>
                {g.ok ? (
                  <span className={styles.gateGap} />
                ) : (
                  <Link
                    href={`/${g.screen === 'event' ? `events/${ev.id}` : g.screen}`}
                    className="btn btn-ghost"
                  >
                    Fix it
                  </Link>
                )}
              </div>
            ))}

            <p className={ev.canAdvance ? styles.gatesMsgGood : styles.gatesMsg}>
              {ev.gatesMessage}
            </p>
          </div>

          <div className={styles.tiers}>
            <span className={styles.tiersLabel}>
              Ticket tiers — standard drives the ladder at ±20%:
            </span>
            {ev.tiers.map((t) => (
              <span key={t.key} className={styles.tier}>
                <span className={styles.tierName}>{t.label}</span>
                <span className={`${styles.tierPrice} tabular`}>{t.price}</span>
                <span className={styles.tierShare}>{t.share}</span>
              </span>
            ))}
            <Link href={`/ticketing?event=${ev.id}`} className={styles.tierLink}>
              set them in Ticketing
            </Link>
          </div>
        </section>

        {/* ----------------------------------------------------- licence --- */}
        <section id="licence">
          <SectionHeading
            note={ev.licenceLate ? 'bar runs past midnight' : 'within the standard licence'}
          >
            Special licence
          </SectionHeading>
          <p className={styles.note}>
            A bar past midnight needs a special licence, applied for at least 20 working days out.
            The bar close above is what decides it — change that and this changes with it.
          </p>
          <LicencePicker eventId={ev.id} value={ev.licence} late={ev.licenceLate} />
        </section>

        {/* ----------------------------------------------------- artists --- */}
        <section id="artists">
          <SectionHeading note={`${ev.artistFloor} to ${ev.artistCeil} on this line-up`}>
            Artists
          </SectionHeading>
          <p className={styles.note}>
            Fee ranges set the floor and ceiling the split works between. Marking someone declined
            takes their fee out of both.
          </p>

          {ev.artists.length === 0 ? (
            <p className={styles.none}>Nobody on the bill yet.</p>
          ) : (
            <ul className={styles.artists}>
              {ev.artists.map((a) => (
                <li key={a.id} className={styles.artist}>
                  <div className={styles.artistMain}>
                    <span className={styles.artistName}>{a.name}</span>
                    <span className={`${styles.status} ${styles[`st_${a.status}`] ?? ''}`}>
                      {a.status}
                    </span>
                    <span className={`${styles.fee} tabular`}>
                      ${a.low}–${a.high}
                    </span>
                    {a.payeeName ? null : (
                      <span
                        className={styles.unlinked}
                        title="No payee record — they cannot be paid yet"
                      >
                        not linked
                      </span>
                    )}
                  </div>
                  <div className={styles.artistFiles}>
                    {a.files.map((f) => (
                      <span
                        key={f.kind}
                        className={`${styles.file} ${f.have ? styles.fileHave : ''}`}
                        title={f.have ? `${f.label} on file` : `${f.label} not in yet`}
                      >
                        <i
                          className={`ph ${f.have ? 'ph-check' : 'ph-circle-dashed'}`}
                          aria-hidden="true"
                        />
                        {f.label}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ------------------------------------------------------- terms --- */}
        <section id="terms">
          <SectionHeading note={ev.modelLabel}>Terms &amp; split</SectionHeading>
          <p className={styles.note}>
            Everybody&rsquo;s floor is paid first — our crew at their logged hours, their artists at
            their agreed minimum. The split divides whatever is left.
          </p>

          <div className={styles.split}>
            <div className={styles.splitCol}>
              <span className={styles.splitLabel}>Their people</span>
              <span className={`${styles.splitBig} tabular`}>{ev.theirTotal}</span>
              <span className={styles.splitNote}>
                {ev.theirFloor} floor + {ev.theirShare} share
              </span>
            </div>
            <div className={styles.splitCol}>
              <span className={styles.splitLabel}>Surplus to split</span>
              <span className={`${styles.splitBig} tabular`}>{ev.surplus}</span>
              <span className={styles.splitNote}>{Math.round(ev.split * 100)}% to them</span>
            </div>
            <div className={styles.splitCol}>
              <span className={styles.splitLabel}>PicklePicklePickle</span>
              <span className={`${styles.splitBig} ${styles[ev.marginHealth]} tabular`}>
                {ev.ourShare}
              </span>
              <span className={styles.splitNote}>{ev.margin} margin · back into the cost base</span>
            </div>
          </div>

          <div className={styles.splitBars}>
            <div>
              <div className={styles.barHead}>
                <span>Their people, against their ceiling</span>
                <span className="tabular">{ev.ceiling}</span>
              </div>
              <p className={styles.factNote}>
                Full pay needs {ev.fullPayAt} through the door. Breakeven is {ev.breakeven}.
              </p>
            </div>
            <div>
              <div className={styles.barHead}>
                <span>Our people, hours in full</span>
                <span className="tabular">{ev.ourPeople}</span>
              </div>
              <p className={styles.factNote}>
                {ev.hours} at $33.66/hr loaded. Paid before any split.
              </p>
            </div>
          </div>

          <DealPanel eventId={ev.id} state={ev.deal} note={ev.dealNote} />
        </section>

        {/* ------------------------------------------------------ labour --- */}
        <section id="labour">
          <SectionHeading note={`${ev.onSiteHours + ev.offSiteHours}h · ${ev.ourPeople}`}>
            Labour
          </SectionHeading>
          <p className={styles.note}>
            Two tables, one record. On-site shifts <em>are</em> the roster — assign someone in
            Roster and they appear here. Off-site tasks carry a predicted figure and the hours
            actually worked.
          </p>

          <div className={styles.table}>
            <div className={styles.tableHead}>
              <span>Role</span>
              <span>Who is on it</span>
              <span className={styles.right}>Hours</span>
              <span className={styles.right}>Loaded</span>
            </div>
            {ev.roleRows.length === 0 ? (
              <p className={styles.none}>No shifts generated yet.</p>
            ) : (
              ev.roleRows.map((r) => (
                <div key={r.role} className={styles.tableRow}>
                  <span>{r.role}</span>
                  <span className={styles.who}>
                    {r.people.map((p) => (
                      <span key={p.name} className={styles.person}>
                        <Avatar initials={p.initials} title={p.name} />
                        {p.name}
                      </span>
                    ))}
                    {r.open > 0 ? <span className={styles.warn}>{r.open} open</span> : null}
                  </span>
                  <span className={`${styles.right} tabular`}>{r.hours}h</span>
                  <span className={`${styles.right} tabular`}>{r.cost}</span>
                </div>
              ))
            )}
          </div>

          {ev.tasks.length > 0 ? (
            <div className={styles.table}>
              <div className={styles.tableHead}>
                <span>Off-site task</span>
                <span className={styles.right}>Predicted</span>
                <span className={styles.right}>Actual</span>
                <span className={styles.right}>Variance</span>
                <span className={styles.right}>Loaded</span>
              </div>
              {ev.tasks.map((t) => (
                <div key={t.id} className={styles.tableRow}>
                  <span>{t.name}</span>
                  <span className={`${styles.right} tabular`}>{t.est}h</span>
                  <span className={`${styles.right} tabular`}>
                    {t.actual === null ? '—' : `${t.actual}h`}
                  </span>
                  <span className={`${styles.right} tabular`}>{t.variance}</span>
                  <span className={`${styles.right} tabular`}>{t.cost}</span>
                </div>
              ))}
            </div>
          ) : null}

          <p className={styles.orgLine}>
            <i className="ph ph-clock" aria-hidden="true" />
            Org-wide labour adds {ev.orgHours} to this event — {ev.orgCost} — its share of that
            month&rsquo;s admin, grants and maintenance across every event in it. Logged in Hours,
            never typed here.
          </p>
          <p className={styles.factNote}>
            {ev.loggedHours} logged against this event from timesheets.
          </p>
        </section>

        {/* ------------------------------------------------ distribution --- */}
        <section id="spread">
          <SectionHeading note={ev.staleCount > 0 ? `${ev.staleCount} stale` : 'nothing stale'}>
            Distribution
          </SectionHeading>
          <ul className={styles.channels}>
            {ev.channels.map((c) => (
              <li key={c.key} className={styles.channel}>
                <i className={`ph ${c.icon}`} aria-hidden="true" />
                <span className={styles.channelName}>{c.name}</span>
                <span className={styles.channelNote}>{c.note ?? ''}</span>
                <span className={styles[c.tone] ?? ''}>{c.state}</span>
              </li>
            ))}
          </ul>
          <Link href={`/promo?event=${ev.id}`} className="btn btn-ghost">
            Work the promo plan
          </Link>
        </section>

        {/* ---------------------------------------------------- activity --- */}
        <section id="activity">
          <SectionHeading note="append-only — nothing here is ever edited">Activity</SectionHeading>
          {ev.activity.length === 0 ? (
            <p className={styles.none}>Nothing has happened to this event yet.</p>
          ) : (
            <ul className={styles.activity}>
              {ev.activity.map((a, i) => (
                <li key={i} className={styles.beat}>
                  <Avatar initials={a.who} title={a.who} />
                  <span className={styles.beatText}>{a.text}</span>
                  <span className={styles.beatWhen}>{a.when}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
