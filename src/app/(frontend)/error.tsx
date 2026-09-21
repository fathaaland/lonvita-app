'use client'

import { Home, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { reportClientError } from '@/lib/logger/client'

/** Catches render and data-fetching errors anywhere under (frontend). Until now these were
 * handled by Next's built-in fallback, which tells nobody but the person looking at the screen. */
export default function FrontendError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportClientError({
      event: 'render_error',
      message: error.message,
      stack: error.stack,
      digest: error.digest,
    })
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center px-6 text-center">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Něco se pokazilo</h1>
        <p className="text-muted-foreground">
          Zkuste to prosím znovu. Pokud potíže přetrvávají, dejte nám vědět.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button className="h-12" onClick={reset}>
            <RotateCcw className="h-5 w-5" /> Zkusit znovu
          </Button>
          <Button asChild className="h-12" variant="outline">
            <Link href="/">
              <Home className="h-5 w-5" /> Na úvod
            </Link>
          </Button>
        </div>
        {error.digest ? (
          <p className="text-xs text-muted-foreground">Kód chyby: {error.digest}</p>
        ) : null}
      </div>
    </div>
  )
}
