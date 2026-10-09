import { NextResponse } from 'next/server'

import { getAppUrl } from '@/lib/auth/app-url'
import { getSafeRedirectPath } from '@/lib/auth/redirect'

// Overrides Payload's own auto-generated logout endpoint at this path. Sessions are a single
// payload-token cookie — whether it was minted by a password login or by the Google callback —
// so signing out is just dropping it.
//
// Also where an expired session is sent (integrations/payload/client.ts): `redirect` is the page
// to return to after signing in again, `reason=expired` lets the sign-in page say why it's there.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const signInUrl = new URL('/auth', getAppUrl(request))
  const redirect = getSafeRedirectPath(searchParams.get('redirect'), '')
  if (redirect) signInUrl.searchParams.set('redirect', redirect)
  if (searchParams.get('reason') === 'expired') signInUrl.searchParams.set('reason', 'expired')

  const response = NextResponse.redirect(signInUrl)
  response.cookies.delete('payload-token')
  return response
}
