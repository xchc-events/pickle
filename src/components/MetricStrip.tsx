import type { Metric } from '@/lib/pipeline'
import styles from './MetricStrip.module.css'

export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <div className={styles.strip}>
      {metrics.map((m) => (
        <div key={m.label} className={styles.cell}>
          <div className={styles.label}>{m.label}</div>
          <div className={styles.figure}>
            <span className={`${styles.value} ${styles[m.tone]} tabular`}>{m.value}</span>
            <span className={styles.sub}>{m.sub}</span>
          </div>
          <div className={styles.note}>{m.note}</div>
          {/* Say so, rather than let a hard-coded figure read as measured. */}
          {m.placeholder ? <div className={styles.estimate}>not measured yet</div> : null}
        </div>
      ))}
    </div>
  )
}
