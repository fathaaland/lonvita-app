'use client'

import { useEffect } from 'react'

import { reportClientError } from '@/lib/logger/client'

/** Last line of defence: an error thrown in the root layout itself replaces the whole document,
 * so this one has to render its own <html>. No shared UI can be used here — whatever crashed may
 * be exactly the thing it would import. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportClientError({
      event: 'global_error',
      message: error.message,
      stack: error.stack,
      digest: error.digest,
    })
  }, [error])

  return (
    <html lang="cs">
      <body>
        <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Něco se pokazilo</h1>
          <p style={{ marginTop: '0.5rem' }}>Zkuste stránku prosím načíst znovu.</p>
          <button
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              border: '1px solid currentColor',
              background: 'transparent',
              cursor: 'pointer',
            }}
            type="button"
          >
            Zkusit znovu
          </button>
          {error.digest ? (
            <p style={{ marginTop: '1rem', fontSize: '0.75rem', opacity: 0.7 }}>
              Kód chyby: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  )
}
