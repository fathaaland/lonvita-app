import { NextResponse } from 'next/server'

import { isAuth0Configured } from '@/lib/auth/auth0/is-configured'

// Public — the frontend uses this to decide whether to redirect into Auth0's hosted
// login (real tenant configured) or fall back to Payload's own local email/password
// auth (no Auth0 env vars set yet).
export async function GET() {
  return NextResponse.json({ auth0: isAuth0Configured() })
}
