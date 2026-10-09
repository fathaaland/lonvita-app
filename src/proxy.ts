import { NextResponse } from 'next/server'

import { CURRENT_PATH_HEADER } from '@/lib/auth/redirect'
import { acceptCorrelationId } from '@/lib/logger/correlation'
import { consumeRateLimit, getClientIp, PROXY_RATE_LIMITS } from '@/lib/security/rate-limit'

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

/** Answers a metered endpoint over its limit before the route runs at all — in the same
 * `{ errors: [{ message }] }` shape Payload uses, so the client shows the message as is. */
const rateLimited = async (request: NextRequest, correlationId: string): Promise<NextResponse | null> => {
  if (request.method !== 'POST') return null

  const { pathname } = request.nextUrl
  const limit = PROXY_RATE_LIMITS[pathname]
  if (!limit) return null

  const result = await consumeRateLimit({
    namespace: `route:${pathname}`,
    identifier: getClientIp(request.headers),
    max: limit.max,
    windowSeconds: limit.windowSeconds,
  })
  if (result.allowed) return null

  return NextResponse.json(
    { errors: [{ message: limit.message }], correlationId },
    {
      status: 429,
      headers: { 'Retry-After': String(result.retryAfter), 'x-correlation-id': correlationId },
    },
  )
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const correlationId = acceptCorrelationId(request.headers.get('x-correlation-id')) ?? crypto.randomUUID()

  const limitedResponse = await rateLimited(request, correlationId)
  if (limitedResponse) return applySecurityHeaders(limitedResponse)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-correlation-id', correlationId)
  requestHeaders.set(CURRENT_PATH_HEADER, pathname)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('x-correlation-id', correlationId)
  // Readable from JS on purpose: it carries no authority, and it is the only way a browser can
  // quote the id of the request that rendered the page when it reports a crash to /api/log.
  // Response headers aren't reachable from the document, so a cookie is the mechanism left.
  response.cookies.set('x-correlation-id', correlationId, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })

  return applySecurityHeaders(response)
}

export const config = {
  matcher: [
    // The event share images stay out like the other images: the correlation cookie set here would
    // keep Vercel's CDN from caching them (it doesn't cache a response that sets a cookie).
    '/((?!admin|trpc|_vercel|_next/static|_next/image|favicon.ico|api/events/[^/]+/share-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
