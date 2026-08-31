import styles from './SectionHeading.module.css'

/**
 * The signature of every section in Nocturne: a small uppercase accent
 * heading, a rule that fades to nothing, and an optional note at the right.
 */
export function SectionHeading({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className={styles.row}>
      <h2 className={styles.title}>{children}</h2>
      <div className="rule-fade" />
      {note ? <span className={styles.note}>{note}</span> : null}
    </div>
  )
}
