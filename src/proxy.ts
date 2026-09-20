import { NextResponse } from 'next/server'

import { CURRENT_PATH_HEADER } from '@/lib/auth/redirect'

import type { NextRequest } from 'next/server'

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

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('x-correlation-id', correlationId)

  return applySecurityHeaders(response)
}

export const config = {
  matcher: [
    '/((?!admin|trpc|_vercel|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
