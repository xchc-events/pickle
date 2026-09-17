'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { COMPACT_SHELL } from '@/lib/shell'
import { Brand } from './Brand'
import styles from './Sidebar.module.css'

/**
 * The menu button on a narrow screen, and the sheet it opens.
 *
 * Only the opening and closing happen here. What the sheet holds is rendered
 * on the server and passed in — the nav the sidebar draws, from the same
 * permission rows — so there is no second idea of who can see what.
 *
 * It is a modal <dialog>, so the browser traps focus in it, holds the page
 * behind it inert, closes it on Escape and hands focus back to the button.
 * What is left to do here is closing it on everything else that should.
 */
export function NavSheet({ children }: { children: React.ReactNode }) {
  const sheet = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const id = useId()
  const pathname = usePathname()

  // Arriving at another page closes it — the back button included.
  useEffect(() => {
    sheet.current?.close()
  }, [pathname])

  // Past the breakpoint the sidebar is back and this is hidden. A modal left
  // open there would hold the whole page inert behind nothing visible.
  useEffect(() => {
    const compact = window.matchMedia(COMPACT_SHELL)
    const widened = () => {
      if (!compact.matches) sheet.current?.close()
    }
    compact.addEventListener('change', widened)
    return () => compact.removeEventListener('change', widened)
  }, [])

  return (
    <>
      <button
        type="button"
        className={styles.menu}
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          sheet.current?.showModal()
          setOpen(true)
        }}
      >
        <i className="ph ph-list" aria-hidden="true" />
      </button>

      <dialog
        id={id}
        ref={sheet}
        className={styles.sheet}
        aria-label="Menu"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          // The dialog covers the screen and is see-through beside the panel,
          // so a click on the dialog itself landed beside it. A click on a
          // link closes it now rather than when the page arrives — and a link
          // to the page already open never changes the path at all.
          const target = event.target as Element
          if (target === event.currentTarget || target.closest('a')) event.currentTarget.close()
        }}
      >
        {/* First, so it takes the focus — right where the menu button had it. */}
        <button
          type="button"
          className={`${styles.menu} ${styles.close}`}
          aria-label="Close menu"
          onClick={() => sheet.current?.close()}
        >
          <i className="ph ph-x" aria-hidden="true" />
        </button>
        <div className={styles.panel}>
          <div className={styles.sheetHead}>
            <Brand />
          </div>
          {children}
        </div>
      </dialog>
    </>
  )
}
