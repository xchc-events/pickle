import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireModule } from '@/lib/permissions'
import {
  greeting,
  homeRefusal,
  homeSub,
  needsCount,
  splitNeeds,
  type Need,
  type Tile,
} from '@/lib/home'
import { loadHome, type HomeLoad } from '@/lib/home-data'
import { SectionHeading } from '@/components/SectionHeading'
import styles from './home.module.css'

/**
 * Home.
 *
 * What needs the person reading, today, and nothing else: the parts of every
 * live event that are waiting on them, the next couple of nights through the
 * door, and their own hours. Every row goes to the screen that fixes it,
 * opened on the night in question — see src/lib/home.ts for whose each thing
 * is and why it counts as today's.
 */
export default async function HomePage() {
  const { user, modules } = await requireModule('home')
  // The venue's own to-do list. Denial is a 404, as everywhere else.
  if (homeRefusal(user)) notFound()

  const home = await loadHome(user, modules)
  const { yours, unclaimed } = splitNeeds(home.needs)

  return (
    <div>
      <header className={styles.header}>
        <h1 className={styles.title}>{greeting(user.name)}</h1>
        <p className={styles.sub}>{homeSub(yours.length, home.live)}</p>
      </header>

      {home.tiles.length > 0 ? (
        <div className={styles.tiles}>
          {home.tiles.map((t) => (
            <TileCell key={t.label} tile={t} />
          ))}
        </div>
      ) : null}

      <div className={styles.body}>
        <section className={styles.main}>
          <div>
            <SectionHeading note={needsCount(yours.length)}>Needs you</SectionHeading>
            {yours.length > 0 ? (
              <ul className={styles.needs}>
                {yours.map((n) => (
                  <NeedRow key={n.key} need={n} />
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>Nothing waiting on you. Genuinely.</p>
            )}
          </div>

          {unclaimed.length > 0 ? (
            <div>
              <SectionHeading note={needsCount(unclaimed.length)}>Nobody’s on these</SectionHeading>
              <ul className={styles.needs}>
                {unclaimed.map((n) => (
                  <NeedRow key={n.key} need={n} />
                ))}
              </ul>
            </div>
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

function NeedRow({ need: n }: { need: Need }) {
  return (
    <li>
      <Link href={n.href} className={styles.need} data-testid="need">
        <i className={`ph ${n.icon} ${styles.needIcon} ${styles[n.tone]}`} aria-hidden="true" />
        <span className={styles.needText}>
          <span className={styles.needTitle}>{n.title}</span>
          <span className={styles.needSub}>{n.sub}</span>
        </span>
        <span className={`${styles.needWhen} ${styles[n.tone]} tabular`}>{n.when}</span>
      </Link>
    </li>
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
      <div className={styles.kicker}>
        {next.length === 1 ? 'Next upcoming event' : 'Next upcoming events'}
      </div>
      {next.length > 0 ? (
        <ul className={styles.nextList}>
          {next.map((n) => (
            <NextEvent key={n.id} next={n} />
          ))}
        </ul>
      ) : (
        <p className={styles.nextNone}>No confirmed night ahead yet.</p>
      )}
    </div>
  )
}

function NextEvent({ next: n }: { next: HomeLoad['next'][number] }) {
  return (
    <li className={styles.nextEvent}>
      <div className={styles.nextName}>{n.name}</div>
      <div className={styles.nextWhen}>{n.when}</div>
      <div className={styles.nextDays}>
        <span className={`${styles.nextFigure} tabular`}>{n.days}</span>
        {n.daysLabel ? <span className={styles.nextDaysLabel}>{n.daysLabel}</span> : null}
      </div>
      <p className={styles.nextLine}>{n.line}</p>
      {n.href ? (
        <Link href={n.href} className={`btn btn-primary ${styles.nextButton}`}>
          {n.cta}
        </Link>
      ) : null}
    </li>
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
        <HoursDetail hours={hours} />
      )}
    </div>
  )
}

function HoursDetail({ hours }: { hours: Exclude<HomeLoad['hours'], 'unlinked' | null> }) {
  // Never a repeat of the total figure above — just what's still ahead of it
  // and how it measures against what the reader is available for.
  const splitLine = [hours.split, hours.capLabel].filter(Boolean).join(' · ')

  return (
    <>
      <div className={styles.hoursFigure}>
        <span className={`${styles.hoursValue} tabular`}>{hours.total}</span>
        <span className={styles.hoursCost}>{hours.cost} at loaded rate</span>
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
      {splitLine ? <p className={styles.hoursSplit}>{splitLine}</p> : null}
      <Link href="/hours" className={`btn btn-primary ${styles.nextButton}`}>
        Log your time
      </Link>
    </>
  )
}
