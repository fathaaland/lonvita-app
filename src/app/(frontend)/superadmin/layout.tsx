import type { Metadata } from 'next'
import type { ReactNode } from 'react'

/** The tab's title — the page itself renders in the browser, so it's named here ("Superadmin · Lonvita"). */
export const metadata: Metadata = { title: 'Superadmin' }

export default function Layout({ children }: { children: ReactNode }) {
  return children
}
