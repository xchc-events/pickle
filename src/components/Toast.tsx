'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Said, ToastKind } from '@/lib/toast'
import styles from './Toast.module.css'

/**
 * The toast layer.
 *
 * Every mutation raises one. It is not a confirmation that a button was
 * pressed — the wording explains what now follows from the change, which is
 * the only part the person reading it cannot see for themselves.
 */

const AUTO_DISMISS_MS = 3400

const ICON: Record<ToastKind, string> = {
  good: 'ph-check-circle',
  warn: 'ph-warning',
  stop: 'ph-warning-octagon',
}

const ToastContext = createContext<(said: Said) => void>(() => {})

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Said | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const say = useCallback((said: Said) => {
    setToast(said)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), AUTO_DISMISS_MS)
  }, [])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return (
    <ToastContext.Provider value={say}>
      {children}
      {toast ? (
        <div className={`${styles.toast} ${styles[toast.kind]}`} role="status" aria-live="polite">
          <i className={`ph ${ICON[toast.kind]} ${styles.icon}`} aria-hidden="true" />
          <span>{toast.text}</span>
        </div>
      ) : null}
    </ToastContext.Provider>
  )
}
