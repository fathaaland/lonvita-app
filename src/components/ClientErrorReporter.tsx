'use client'

import { useEffect } from 'react'

import { reportClientError } from '@/lib/logger/client'

/** Failures that never reach an error boundary: a rejected promise from a fetch nobody awaited,
 * an exception inside an event handler. Without this they exist only in the user's own console. */
export function ClientErrorReporter() {
  useEffect(() => {
    // A loop in an interval or an effect can throw the same error hundreds of times a minute;
    // the first one is the diagnosis, the rest are just noise (and quota).
    const alreadyReported = new Set<string>()
    const reportOnce = (event: string, message: string, stack?: string) => {
      const key = `${event}:${message}`
      if (alreadyReported.has(key)) return
      alreadyReported.add(key)
      reportClientError({ event, message, stack })
    }

    const onError = (event: ErrorEvent) => {
      reportOnce(
        'window_error',
        event.message || 'Unknown error',
        event.error instanceof Error ? event.error.stack : undefined,
      )
    }

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      reportOnce(
        'unhandled_rejection',
        reason instanceof Error ? reason.message : String(reason),
        reason instanceof Error ? reason.stack : undefined,
      )
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
