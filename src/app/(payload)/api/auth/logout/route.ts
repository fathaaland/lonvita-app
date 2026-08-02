import { NextResponse } from 'next/server'

import { getAuth0LogoutPath } from '@/lib/auth/auth0/routes'

// Overrides Payload's own auto-generated logout endpoint at this path so that logging
// out always terminates the Auth0-level session too, not just any Payload cookie.
export async function GET() {
  const auth0LogoutUrl = new URL(getAuth0LogoutPath('/login'), process.env.NEXT_PUBLIC_APP_URL!)

  return NextResponse.redirect(auth0LogoutUrl)
}
