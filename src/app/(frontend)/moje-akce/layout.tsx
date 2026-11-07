import type { Metadata } from 'next'
import type { ReactNode } from 'react'

/** The tab's title — the page itself renders in the browser, so it's named here ("Moje akce · Lonvita"). */
export const metadata: Metadata = { title: 'Moje akce' }

export default function Layout({ children }: { children: ReactNode }) {
  return children
}
