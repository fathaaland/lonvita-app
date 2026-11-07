import type { Metadata, Viewport } from 'next'
import { DM_Sans } from 'next/font/google'
import React from 'react'
import './globals.css'
import { Providers } from './providers'
import { EnvWarningBanner } from '@/components/EnvWarningBanner'
import { ACCESSIBILITY_PREFS_SCRIPT } from '@/lib/accessibilityPrefs'

/** The app's typeface — downloaded at build time and served from our own domain (no request to
 * Google from the visitor's browser), with the Czech letters (latin-ext). Every weight in one file. */
const dmSans = DM_Sans({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-dm-sans' })

export const metadata: Metadata = {
  // Shared links need absolute URLs in their Open Graph tags (the event detail's preview image).
  // Without the variable Next falls back on its own (the Vercel production URL, or localhost).
  metadataBase: process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL) : undefined,
  description: 'Lonvita — komunitní platforma obce. Akce, dobrovolnictví a spolky na jednom místě.',
  // Each page names itself ("Moje akce"); the tab reads "Moje akce · Lonvita".
  title: { default: 'Lonvita', template: '%s · Lonvita' },
  applicationName: 'Lonvita',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f9efe7' },
    { media: '(prefers-color-scheme: dark)', color: '#2e2e2e' },
  ],
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    // The pre-paint script sets the font scale and contrast class on <html> before React gets
    // there, so the attributes legitimately differ from the server's at hydration.
    <html lang="cs" className={dmSans.variable} suppressHydrationWarning>
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
