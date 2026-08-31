import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import '@phosphor-icons/web/regular'
import './globals.css'

// Inter 400/500/600. Headings are never bolder than 500 — see tokens.css.
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
})

export const metadata: Metadata = {
  title: 'PicklePicklePickle',
  description: 'Event management for XCHC, Ōtautahi Christchurch.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-NZ" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
