import { NextResponse } from 'next/server'

import { isAuth0Configured } from '@/lib/auth/auth0/is-configured'
import { getAuth0LogoutPath } from '@/lib/auth/auth0/routes'

// Overrides Payload's own auto-generated logout endpoint at this path so that logging
// out always terminates the Auth0-level session too, not just any Payload cookie — but
// only once a real Auth0 tenant is configured. Until then there's no Auth0 session to
// terminate, so this just clears the local Payload cookie directly.
export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  if (!isAuth0Configured()) {
    const response = NextResponse.redirect(new URL('/auth', appUrl))
    response.cookies.delete('payload-token')
    return response
  }

  const auth0LogoutUrl = new URL(getAuth0LogoutPath('/auth'), appUrl)
  return NextResponse.redirect(auth0LogoutUrl)
}
