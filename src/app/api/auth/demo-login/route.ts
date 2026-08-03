import { createHash } from 'node:crypto'

import { SignJWT } from 'jose'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { isAuth0Configured } from '@/lib/auth/auth0/is-configured'

const DEMO_ROLES = {
  admin: { label: 'Admin obce', roleRow: 'admin' as const },
  organizer: { label: 'Pořadatel', roleRow: 'organizer' as const },
  participant: { label: 'Účastník', roleRow: null },
}

type DemoRole = keyof typeof DEMO_ROLES

const DEMO_MUNICIPALITY_NAME = 'Demo obec'

/**
 * One-click demo login for local testing without a real Auth0 tenant — picks a role,
 * ensures a matching seeded user/profile/municipality exist, and hand-mints the same
 * kind of payload-token JWT the Auth0 admin bridge route already uses. Only available
 * while Auth0 isn't configured; a real deployment should never expose this.
 */
export async function POST(request: Request) {
  if (isAuth0Configured()) {
    return NextResponse.json({ error: 'Demo login is disabled once Auth0 is configured.' }, { status: 403 })
  }

  const { role } = (await request.json()) as { role?: string }
  if (!role || !(role in DEMO_ROLES)) {
    return NextResponse.json({ error: 'Unknown demo role.' }, { status: 400 })
  }
  const demoRole = DEMO_ROLES[role as DemoRole]

  const payload = await getPayload({ config })

  // Ensure a demo municipality exists so Profile creation always has somewhere to point.
  const existingMuni = await payload.find({
    collection: 'municipalities',
    where: { name: { equals: DEMO_MUNICIPALITY_NAME } },
    limit: 1,
    overrideAccess: true,
  })
  const municipality =
    existingMuni.docs[0] ??
    (await payload.create({
      collection: 'municipalities',
      data: { name: DEMO_MUNICIPALITY_NAME, rulesForCreation: 'approved_organizers' },
      overrideAccess: true,
    }))

  const email = `demo-${role}@lonvita.local`

  const existingUser = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })
  const user =
    existingUser.docs[0] ??
    (await payload.create({
      collection: 'users',
      data: { email, role: 'user' },
      overrideAccess: true,
    }))

  const existingProfile = await payload.find({
    collection: 'profiles',
    where: { user: { equals: user.id } },
    limit: 1,
    overrideAccess: true,
  })
  if (!existingProfile.docs[0]) {
    await payload.create({
      collection: 'profiles',
      data: {
        user: user.id,
        fullName: demoRole.label,
        municipality: municipality.id,
        onboardingCompleted: true,
      },
      overrideAccess: true,
    })
  }

  if (demoRole.roleRow) {
    const existingRole = await payload.find({
      collection: 'user-roles',
      where: {
        and: [{ user: { equals: user.id } }, { role: { equals: demoRole.roleRow } }],
      },
      limit: 1,
      overrideAccess: true,
    })
    if (!existingRole.docs[0]) {
      await payload.create({
        collection: 'user-roles',
        data: { user: user.id, municipality: municipality.id, role: demoRole.roleRow },
        overrideAccess: true,
      })
    }
  }

  // Reproduce Payload's own JWT-signing derivation (same as /api/admin/auth0/complete)
  // so payload-token-jwt.ts's authenticateViaPayloadToken branch verifies this token.
  const hashedSecret = createHash('sha256').update(process.env.PAYLOAD_SECRET!).digest('hex').slice(0, 32)
  const secretKey = new TextEncoder().encode(hashedSecret)

  const token = await new SignJWT({ id: user.id, email: user.email, collection: 'users', role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('2h')
    .sign(secretKey)

  const response = NextResponse.json({
    ok: true,
    redirectTo: role === 'admin' ? '/admin-obce' : '/',
  })
  response.cookies.set('payload-token', token, {
    httpOnly: true,
    secure: process.env.NEXT_PUBLIC_APP_URL?.startsWith('https') ?? false,
    sameSite: 'lax',
    path: '/',
    maxAge: 7200,
  })

  return response
}
