import { createHash } from 'node:crypto'

import { SignJWT } from 'jose'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { getAppUrl } from '@/lib/auth/app-url'
import { auth0 } from '@/lib/auth/auth0/client'
import { upsertUser } from '@/lib/auth/users'

/**
 * Reached after the Auth0 SDK's own login/callback flow completes (the admin login
 * button sets returnTo=/api/admin/auth0/complete). Payload's admin UI has its own
 * login/cookie mechanism that knows nothing about Auth0 sessions, so this route
 * bridges the two: it resolves/creates the Payload user, requires role === 'admin',
 * then hand-mints a Payload-compatible JWT and sets it as the payload-token cookie —
 * this is what payload-token-jwt.ts's authenticateViaPayloadToken branch verifies.
 */
export async function GET(request: Request) {
  const appUrl = getAppUrl(request)

  const session = await auth0.getSession()
  if (!session) {
    return NextResponse.redirect(new URL('/admin/login?error=no-session', appUrl))
  }

  const email = session.user.email?.toLowerCase()
  if (!email) {
    return NextResponse.redirect(new URL('/admin/login?error=unknown-provider', appUrl))
  }

  const payload = await getPayload({ config })
  const user = await upsertUser({ payload, email })

  if (user.role !== 'admin') {
    return NextResponse.redirect(new URL('/admin/login?error=not-authorized', appUrl))
  }

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

  // Reproduce Payload's own JWT-signing derivation so the strategy's manual
  // jwtVerify() call validates this token.
  const hashedSecret = createHash('sha256').update(process.env.PAYLOAD_SECRET!).digest('hex').slice(0, 32)
  const secretKey = new TextEncoder().encode(hashedSecret)

  const token = await new SignJWT({ id: user.id, email: user.email, collection: 'users', role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('2h')
    .sign(secretKey)

  const response = NextResponse.redirect(new URL('/admin', appUrl))
  response.cookies.set('payload-token', token, {
    httpOnly: true,
    secure: appUrl.startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: 7200,
  })

  return response
}
