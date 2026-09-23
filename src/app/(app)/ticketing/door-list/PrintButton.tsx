'use client'

/** The only interactive part of the print view — everything else is static. */
export function PrintButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      Print
    </button>
  )
}
