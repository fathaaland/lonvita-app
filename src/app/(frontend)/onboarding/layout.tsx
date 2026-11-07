import type { Metadata } from 'next'
import type { ReactNode } from 'react'

/** The tab's title — the page itself renders in the browser, so it's named here ("Dokončení registrace · Lonvita"). */
export const metadata: Metadata = { title: 'Dokončení registrace' }

export default function Layout({ children }: { children: ReactNode }) {
  return children
}
