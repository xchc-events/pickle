import styles from './Avatar.module.css'

export function Avatar({
  initials,
  title,
  accent = false,
  external = false,
}: {
  initials: string
  title: string
  accent?: boolean
  external?: boolean
}) {
  const tone = external ? styles.external : accent ? styles.accent : ''
  return (
    <span className={`${styles.avatar} ${tone}`} title={title}>
      {initials}
    </span>
  )
}
