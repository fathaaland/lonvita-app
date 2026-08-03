'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

const ERROR_MESSAGES: Record<string, string> = {
  'no-session': 'Login did not complete. Please try again.',
  'not-authorized': 'This account does not have admin access.',
  'unknown-provider': 'We could not verify your identity provider.',
  'internal-error': 'Something went wrong. Please try again.',
}

export const Auth0LoginButton = () => {
  const searchParams = useSearchParams()
  const errorCode = searchParams?.get('error')
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES['internal-error']) : null
  const [auth0Configured, setAuth0Configured] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/auth/mode')
      .then((res) => res.json())
      .then((data) => setAuth0Configured(Boolean(data?.auth0)))
      .catch(() => setAuth0Configured(false))
  }, [])

  if (auth0Configured === false) {
    // No Auth0 tenant configured yet — the button would just redirect into a 503. Use
    // Payload's own local admin login form below instead (a user with role: admin works).
    return null
  }

  return (
    <div style={{ marginBottom: '1rem' }}>
      {errorMessage ? (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            borderRadius: '4px',
            background: '#fee2e2',
            color: '#991b1b',
          }}
        >
          {errorMessage}
        </div>
      ) : null}
      <a
        href="/auth/login?returnTo=/api/admin/auth0/complete"
        style={{
          display: 'block',
          textAlign: 'center',
          padding: '0.75rem 1rem',
          borderRadius: '4px',
          background: '#000',
          color: '#fff',
          textDecoration: 'none',
          fontWeight: 600,
        }}
      >
        Log in with Auth0
      </a>
    </div>
  )
}
