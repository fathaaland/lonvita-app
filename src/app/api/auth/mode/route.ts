import { NextResponse } from 'next/server'

import { isGoogleAuthConfigured } from '@/lib/auth/google/provider'

// Public — tells the sign-in page which external providers are actually wired up, so it never
// offers a button that would dead-end on a missing GOOGLE_CLIENT_ID.
export async function GET() {
  return NextResponse.json({ google: isGoogleAuthConfigured() })
}
