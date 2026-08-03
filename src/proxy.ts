import { NextResponse } from 'next/server'

import { auth0, AUTH0_CALLBACK_PATH } from '@/lib/auth/auth0/client'
import { isAuth0Configured } from '@/lib/auth/auth0/is-configured'
import { CURRENT_PATH_HEADER } from '@/lib/auth/redirect'

import type { NextRequest } from 'next/server'

const AUTH0_ROUTE = '/auth'

const applySecurityHeaders = (response: NextResponse) => {
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  )
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }
  return response
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const correlationId = request.headers.get('x-correlation-id') ?? crypto.randomUUID()

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-correlation-id', correlationId)
  requestHeaders.set(CURRENT_PATH_HEADER, pathname)

  // Let the Auth0 SDK own its own mounted sub-routes (/auth/login, /auth/callback,
  // /auth/logout, /auth/profile, /auth/access-token) plus the configured callback path.
  // The bare "/auth" path itself is our own sign-in page and must NOT be intercepted here.
  if (pathname.startsWith(`${AUTH0_ROUTE}/`) || pathname === AUTH0_CALLBACK_PATH) {
    if (!isAuth0Configured()) {
      // No Auth0 tenant wired up yet (AUTH0_DOMAIN/CLIENT_ID/SECRET/CLIENT_SECRET unset in
      // .env) — auth0.middleware() would throw DomainResolutionError. Fail as a clean,
      // visible error instead of an unhandled 500.
      return applySecurityHeaders(
        NextResponse.json(
          { error: 'Auth0 is not configured. Set AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_SECRET, and AUTH0_CLIENT_SECRET in .env.' },
          { status: 503 },
        ),
      )
    }
    const auth0Response = await auth0.middleware(request)
    return applySecurityHeaders(auth0Response)
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('x-correlation-id', correlationId)

  return applySecurityHeaders(response)
}

export const config = {
  matcher: [
    '/((?!admin|trpc|_vercel|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
