import type { Metadata } from 'next'
import React from 'react'
import './globals.css'
import { Providers } from './providers'
import { EnvWarningBanner } from '@/components/EnvWarningBanner'
import { ACCESSIBILITY_PREFS_SCRIPT } from '@/lib/accessibilityPrefs'

export const metadata: Metadata = {
  // Shared links need absolute URLs in their Open Graph tags (the event detail's preview image).
  // Without the variable Next falls back on its own (the Vercel production URL, or localhost).
  metadataBase: process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL) : undefined,
  description: 'Lonvita — komunitní platforma obce.',
  title: 'Lonvita',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    // The pre-paint script sets the font scale and contrast class on <html> before React gets
    // there, so the attributes legitimately differ from the server's at hydration.
    <html lang="cs" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: ACCESSIBILITY_PREFS_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <EnvWarningBanner />
      </body>
    </html>
  )
}
