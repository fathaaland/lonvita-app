import type { Metadata } from 'next'
import React from 'react'
import './globals.css'
import { Providers } from './providers'

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
    <html lang="cs">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
