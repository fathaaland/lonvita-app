import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'

type CreateUserBody = {
  email?: string
  password?: string
  fullName?: string
  municipality?: number
}

/** Lets a platform superadmin provision an account directly (no self-service registration
 * flow) — creates the user, their profile, and a "participant" role in the chosen
 * municipality, mirroring what /api/auth/register does for a self-signup. */
export async function POST(request: Request) {
  const payload = await getPayload({ config })

  const { user: actor } = await payload.auth({ headers: request.headers })
  if (!actor || actor.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await request.json()) as CreateUserBody
  const email = body.email?.trim().toLowerCase()
  const fullName = body.fullName?.trim()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Zadejte platný e-mail.' }, { status: 400 })
  }
  if (!body.password || body.password.length < 8) {
    return NextResponse.json({ error: 'Heslo musí mít alespoň 8 znaků.' }, { status: 400 })
  }
  if (!fullName || fullName.length < 2) {
    return NextResponse.json({ error: 'Zadejte celé jméno.' }, { status: 400 })
  }
  if (!body.municipality) {
    return NextResponse.json({ error: 'Vyberte obec.' }, { status: 400 })
  }

  try {
    const newUser = await payload.create({
      collection: 'users',
      data: { email, password: body.password, role: 'user' },
      overrideAccess: true,
    })

    await payload.create({
      collection: 'profiles',
      // The superadmin already establishes the user↔municipality relation here, so onboarding
      // (which would otherwise ask for it again) is marked complete up front.
      data: { user: newUser.id, fullName, municipality: body.municipality, onboardingCompleted: true },
      overrideAccess: true,
    })

    await payload.create({
      collection: 'user-roles',
      data: { user: newUser.id, municipality: body.municipality, role: 'participant' },
      overrideAccess: true,
    })

    return NextResponse.json({ id: newUser.id, email: newUser.email }, { status: 201 })
  } catch (error) {
    console.error('[superadmin/create-user] failed', error)
    return NextResponse.json({ error: 'Nepodařilo se vytvořit uživatele — e-mail už možná existuje.' }, { status: 500 })
  }
}
