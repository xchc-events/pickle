import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireModule } from '@/lib/permissions'
import { greeting, homeRefusal, homeSub, needsCount, shownNeeds, type Tile } from '@/lib/home'
import { loadHome, type HomeLoad } from '@/lib/home-data'
import { SectionHeading } from '@/components/SectionHeading'
import styles from './home.module.css'

/**
 * Home.
 *
 * What needs the person reading, today, and nothing else: the parts of every
 * live event that are waiting on them, the next night through the door, and
 * their own hours. Every row goes to the screen that fixes it, opened on the
 * night in question — see src/lib/home.ts for whose each thing is and why it
 * counts as today's.
 */
export default async function HomePage() {
  const { user, modules } = await requireModule('home')
  // The venue's own to-do list. Denial is a 404, as everywhere else.
  if (homeRefusal(user)) notFound()

  const home = await loadHome(user, modules)
  const { shown, more } = shownNeeds(home.needs)

  return (
    <div>
      <header className={styles.header}>
        <h1 className={styles.title}>{greeting(user.name)}</h1>
        <p className={styles.sub}>{homeSub(home.needs.length, home.live)}</p>
      </header>

      {home.tiles.length > 0 ? (
        <div className={styles.tiles}>
          {home.tiles.map((t) => (
            <TileCell key={t.label} tile={t} />
          ))}
        </div>
      ) : null}

      <div className={styles.body}>
        <section className={styles.main} aria-label="Needs you">
          <SectionHeading note={needsCount(home.needs.length)}>Needs you</SectionHeading>

          {shown.length > 0 ? (
            <ul className={styles.needs}>
              {shown.map((n) => (
                <li key={n.key}>
                  <Link href={n.href} className={styles.need} data-testid="need">
                    <i
                      className={`ph ${n.icon} ${styles.needIcon} ${styles[n.tone]}`}
                      aria-hidden="true"
                    />
                    <span className={styles.needText}>
                      <span className={styles.needTitle}>{n.title}</span>
                      <span className={styles.needSub}>
                        {n.sub}
                        {/* It reached this reader because nobody named could act on it. */}
                        {n.claim === 'unclaimed' ? (
                          <span className={styles.unclaimed}> · nobody’s on it</span>
                        ) : null}
                      </span>
                    </span>
                    <span className={`${styles.needWhen} ${styles[n.tone]} tabular`}>{n.when}</span>
                    <span className={styles.needCta}>
                      {n.cta} <span aria-hidden="true">&rarr;</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>Nothing waiting on you. Genuinely.</p>
          )}

          {more > 0 ? (
            <p className={styles.more}>
              {more} more after these.
              {modules.includes('pipeline') ? (
                <>
                  {' '}
                  <Link href="/pipeline?sort=attention">
                    The Pipeline sorts every event by what needs attention
                  </Link>
                  .
                </>
              ) : null}
            </p>
          ) : null}
        </section>

        <aside className={styles.aside}>
          <NextCard next={home.next} />
          <HoursCard hours={home.hours} />
        </aside>
      </div>
    </div>
  )
}

function TileCell({ tile: t }: { tile: Tile }) {
  const inner = (
    <>
      <span className={styles.tileLabel}>{t.label}</span>
      <span className={styles.tileFigure}>
        <span className={`${styles.tileValue} ${styles[t.tone]} tabular`}>{t.value}</span>
        <span className={styles.tileSub}>{t.sub}</span>
      </span>
    </>
  )
  return t.href ? (
    <Link href={t.href} className={styles.tile}>
      {inner}
    </Link>
  ) : (
    <div className={styles.tile}>{inner}</div>
  )
}

function NextCard({ next }: { next: HomeLoad['next'] }) {
  return (
    <div className={styles.nextCard}>
      <div className={styles.kicker}>Next through the door</div>
      {next ? (
        <>
          <div className={styles.nextName}>{next.name}</div>
          <div className={styles.nextWhen}>{next.when}</div>
          <div className={styles.nextDays}>
            <span className={`${styles.nextFigure} tabular`}>{next.days}</span>
            {next.daysLabel ? <span className={styles.nextDaysLabel}>{next.daysLabel}</span> : null}
          </div>
          <p className={styles.nextLine}>{next.line}</p>
          {next.href ? (
            <Link href={next.href} className={`btn btn-primary ${styles.nextButton}`}>
              {next.cta}
            </Link>
          ) : null}
        </>
      ) : (
        <p className={styles.nextNone}>No confirmed night ahead yet.</p>
      )}
    </div>
  )
}

function HoursCard({ hours }: { hours: HomeLoad['hours'] }) {
  if (hours === null) return null

  return (
    <div className={styles.hoursCard}>
      <div className={styles.kickerMuted}>Your hours this month</div>
      {hours === 'unlinked' ? (
        <p className={styles.hoursNote}>
          This account is not linked to a person, so no hours are logged against it. Admin can link
          it.
        </p>
      ) : (
        <>
          <div className={styles.hoursFigure}>
            <span className={`${styles.hoursValue} tabular`}>{hours.total}</span>
            <span className={styles.hoursCost}>
              {hours.cost} at {hours.rate}
            </span>
          </div>
          {hours.pct !== null ? (
            <div
              className={styles.track}
              role="img"
              aria-label={`${hours.pct}% ${hours.capLabel ?? ''}`}
            >
              <div className={styles.fill} style={{ width: `${hours.pct}%` }} />
            </div>
          ) : null}
          <p className={styles.hoursSplit}>
            {hours.split}
            {hours.capLabel ? ` · ${hours.capLabel}` : ''}
          </p>
          <p className={styles.hoursNote}>
            Every hour lands on an event — its own, or shared across the month’s — which is the only
            reason the profit share can be argued.
          </p>
          <Link href="/hours" className={styles.hoursLink}>
            Log your time <span aria-hidden="true">&rarr;</span>
          </Link>
        </>
      )}
    </div>
  )
}
