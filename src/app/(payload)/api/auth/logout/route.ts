import { NextResponse } from 'next/server'

import { getAppUrl } from '@/lib/auth/app-url'

// Overrides Payload's own auto-generated logout endpoint at this path. Sessions are a single
// payload-token cookie — whether it was minted by a password login or by the Google callback —
// so signing out is just dropping it.
export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL('/auth', getAppUrl(request)))
  response.cookies.delete('payload-token')
  return response
}
