import React from 'react'
import './globals.css'
import { Providers } from './providers'

export const metadata = {
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
