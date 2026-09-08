import { money } from '@/lib/format'
import type { SettlementLine } from '@/lib/settlement'
import styles from './finance.module.css'

/**
 * The settlement P&L.
 *
 * Presentation only — every figure arrived computed. The order, the two rules
 * and the wording are specification from the handoff, so this renders what
 * `settlementLines` returned rather than deciding anything itself.
 *
 * Deductions carry a real minus sign rather than being implied by position. A
 * settlement sheet is read aloud across a table by two people who are about to
 * disagree about it, and "is that coming off or going on" is not a question
 * the layout should leave open.
 */
export function SettlementSheet({ lines }: { lines: SettlementLine[] }) {
  return (
    <div className={styles.settle}>
      {lines.map((l) => {
        const total = l.tone !== 'plain'
        const kept = l.key === 'retained' && !l.negative
        const loss = l.key === 'retained' && l.negative

        return (
          <div
            key={l.key}
            className={[
              styles.settleRow,
              l.ruleAbove ? styles.settleRuled : '',
              total ? styles.settleTotal : '',
              kept ? styles.settleKept : '',
              loss ? styles.settleLoss : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className={styles.settleLabel}>{l.label}</span>
            <span className={styles.settleValue}>
              {l.deduction ? `− ${money(l.value)}` : money(l.value)}
            </span>
            <span className={styles.settleNote}>{l.note}</span>
          </div>
        )
      })}
    </div>
  )
}
