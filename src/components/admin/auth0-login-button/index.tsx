'use client'

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
