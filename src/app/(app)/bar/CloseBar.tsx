'use client'

import { useState, useTransition } from 'react'
import { useToast } from '@/components/Toast'
import { money } from '@/lib/format'
import { closeBarByHand, closeBarFromTill, previewTill, type TillPreview } from './actions'
import styles from './bar.module.css'

/** `2026-09-19T21:04:00` as the venue says it: `9:04pm`. */
function clock(wall: string | null): string {
  const m = /T(\d{2}):(\d{2})/.exec(wall ?? '')
  if (!m) return '—'
  const h = Number(m[1])
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]}${h < 12 ? 'am' : 'pm'}`
}

/**
 * Closing the bar.
 *
 * Off the till where Epos Now is connected: the figures are read and shown to
 * a person first, then closing reads the till again on the server — the numbers
 * shown here are never sent back as the numbers saved. By hand where it is not,
 * or where the till got the night wrong.
 *
 * The GST terms are on every field. Take is what the till rang up, GST
 * included; profit is after stock and GST excluded. Swapped, they move the
 * settlement silently.
 */
export function CloseBar({
  eventId,
  canClose,
  tillReady,
  tillWhy,
  barHalf,
}: {
  eventId: string
  /** False until the night has come. */
  canClose: boolean
  tillReady: boolean
  tillWhy: string | null
  barHalf: { barTake: number; barProfit: number } | null
}) {
  const say = useToast()
  const [pending, start] = useTransition()
  const [preview, setPreview] = useState<TillPreview | null>(null)
  const [v, setV] = useState({
    barTake: barHalf?.barTake?.toString() ?? '',
    barProfit: barHalf?.barProfit?.toString() ?? '',
  })

  if (!canClose) {
    return (
      <p className={styles.closeNote}>
        This night has not happened yet, so there is no bar to close.
      </p>
    )
  }

  // An empty box is not a zero. NaN lets the server refuse it in words.
  const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s))

  return (
    <div className={styles.close}>
      {tillReady ? (
        <div className={styles.closeTill}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => start(async () => setPreview(await previewTill(eventId)))}
          >
            <i className="ph ph-cash-register" aria-hidden="true" />
            {preview?.ok ? 'Read the till again' : 'Read the till'}
          </button>

          {preview && !preview.ok ? <p className={styles.closeWarn}>{preview.why}</p> : null}

          {preview?.ok ? (
            <div className={styles.closePreview}>
              <p className={styles.closeFigures}>
                <b className="tabular">{money(preview.take)}</b> over the bar ·{' '}
                <b className="tabular">{money(preview.profit)}</b> after stock
              </p>
              <p className={styles.closeNote}>
                {preview.transactions} {preview.transactions === 1 ? 'sale' : 'sales'} between{' '}
                {clock(preview.firstSale)} and {clock(preview.lastSale)}, across {preview.products}{' '}
                {preview.products === 1 ? 'product' : 'products'}.
                {preview.missingCost > 0
                  ? ` ${preview.missingCost} ${preview.missingCost === 1 ? 'has' : 'have'} no cost price in Epos Now, so the profit is overstated by ${preview.missingCost === 1 ? 'it' : 'them'}.`
                  : ''}
              </p>
              <button
                type="button"
                className={styles.closeSave}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    say(await closeBarFromTill(eventId))
                    setPreview(null)
                  })
                }
              >
                {barHalf ? 'Close it again off the till' : 'Close the bar off the till'}
              </button>
            </div>
          ) : null}
        </div>
      ) : tillWhy ? (
        <p className={styles.closeNote}>{tillWhy}</p>
      ) : null}

      <details className={styles.closeHand} open={!tillReady}>
        <summary>{barHalf ? 'Correct it by hand' : 'Close it by hand'}</summary>
        <div className={styles.closeGrid}>
          <label className={styles.closeField}>
            <span className={styles.closeLabel}>Bar take</span>
            <span className={styles.closeInputWrap}>
              <span className={styles.closePrefix}>$</span>
              <input
                className={styles.closeInput}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={v.barTake}
                disabled={pending}
                onChange={(e) => setV({ ...v, barTake: e.target.value })}
              />
            </span>
            <span className={styles.closeHint}>GST included — gross over the bar</span>
          </label>
          <label className={styles.closeField}>
            <span className={styles.closeLabel}>Bar profit</span>
            <span className={styles.closeInputWrap}>
              <span className={styles.closePrefix}>$</span>
              <input
                className={styles.closeInput}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={v.barProfit}
                disabled={pending}
                onChange={(e) => setV({ ...v, barProfit: e.target.value })}
              />
            </span>
            <span className={styles.closeHint}>after stock, GST excluded</span>
          </label>
        </div>
        <button
          type="button"
          className={styles.closeSave}
          disabled={pending}
          onClick={() =>
            start(async () =>
              say(
                await closeBarByHand(eventId, {
                  barTake: num(v.barTake),
                  barProfit: num(v.barProfit),
                }),
              ),
            )
          }
        >
          {barHalf ? 'Save the correction' : 'Close the bar by hand'}
        </button>
      </details>
    </div>
  )
}
