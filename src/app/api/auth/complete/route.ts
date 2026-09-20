import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { getAppUrl } from '@/lib/auth/app-url'
import { auth0 } from '@/lib/auth/auth0/client'
import { getSafeRedirectPath } from '@/lib/auth/redirect'
import { upsertUser } from '@/lib/auth/users'

/**
 * Reached after the Auth0 SDK's own login/callback flow completes for the regular app
 * (the login button sets returnTo=/api/auth/complete). The client-side auth flow can't
 * call a Next.js server action directly from a plain redirect, so this HTTP route does
 * what `authenticateUser()` (lib/actions/auth/auth-user.ts) does for server components:
 * find-or-create the Payload user + auth-identity from the live Auth0 session. No admin
 * check, no payload-token minting — the frontend authenticates its own API calls via the
 * Auth0-session-fallback branch of payload-token-jwt.ts, which only needs the
 * auth-identities row this route ensures exists.
 */
export async function GET(request: Request) {
  const appUrl = getAppUrl(request)
  const { searchParams } = new URL(request.url)
  const returnTo = getSafeRedirectPath(searchParams.get('returnTo'), '/')

  const session = await auth0.getSession()
  if (!session) {
    return NextResponse.redirect(new URL(`${returnTo}?authError=no-session`, appUrl))
  }

  const email = session.user.email?.toLowerCase()
  if (!email) {
    return NextResponse.redirect(new URL(`${returnTo}?authError=unknown-provider`, appUrl))
  }

  const payload = await getPayload({ config })
  const user = await upsertUser({ payload, email, fullName: session.user.name })

  const provider = session.user.sub.split('|')[0] ?? 'auth0'
  const existingIdentity = await payload.find({
    collection: 'auth-identities',
    where: { providerSubject: { equals: session.user.sub } },
    limit: 1,
    overrideAccess: true,
  })

  const identityData = {
    user: user.id,
    providerSubject: session.user.sub,
    provider,
    email,
    emailVerified: Boolean(session.user.email_verified),
    profile: session.user,
    lastLoginAt: new Date().toISOString(),
    lastSyncedAt: new Date().toISOString(),
  }

  if (existingIdentity.docs[0]) {
    await payload.update({
      collection: 'auth-identities',
      id: existingIdentity.docs[0].id,
      data: identityData,
      overrideAccess: true,
    })
  } else {
    await payload.create({ collection: 'auth-identities', data: identityData, overrideAccess: true })
  }

  // Someone who still owes us onboarding goes there directly. The home page has its own
  // gate for this, but reaching it through "/" meant the app rendered around them until the
  // client-side bounce landed — and here the answer is already in the database.
  const profiles = await payload.find({
    collection: 'profiles',
    where: { user: { equals: user.id } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  const destination = profiles.docs[0]?.onboardingCompleted ? returnTo : '/onboarding'

  return NextResponse.redirect(new URL(destination, appUrl))
}
