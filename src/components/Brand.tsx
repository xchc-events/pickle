import styles from './Brand.module.css'

/**
 * The brand mark: three circles stepping down the accent ramp. There are no
 * image assets in this product — this is the only logo, and it is inline SVG.
 */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={styles.lockup}>
      <span className={styles.tile}>
        <svg width="19" height="19" viewBox="0 0 19 19" aria-hidden="true">
          <circle cx="5.5" cy="9.5" r="4" fill="var(--color-accent)" />
          <circle cx="9.5" cy="9.5" r="4" fill="var(--color-accent-500)" />
          <circle cx="13.5" cy="9.5" r="4" fill="var(--color-accent-700)" />
        </svg>
      </span>
      {compact ? null : (
        <span className={styles.words}>
          <span className={styles.name}>PicklePicklePickle</span>
          <span className={styles.sub}>XCHC · Ōtautahi Christchurch</span>
        </span>
      )}
    </div>
  )
}
