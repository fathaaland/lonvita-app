import type { Metadata } from 'next'
import type { ReactNode } from 'react'

/** The tab's title — the page itself renders in the browser, so it's named here ("Balíčky a fakturace · Lonvita"). */
export const metadata: Metadata = { title: 'Balíčky a fakturace' }

export default function Layout({ children }: { children: ReactNode }) {
  return children
}
