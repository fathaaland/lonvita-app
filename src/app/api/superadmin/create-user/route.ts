import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { isValidEmail, isValidPassword } from '@/lib/validation'

const GENDERS = ['zena', 'muz', 'jine', 'neuvedeno'] as const
// Same lenient Czech format as the onboarding phone step.
const PHONE_RE = /^(\+420|00420)?\s?[0-9]{3}\s?[0-9]{3}\s?[0-9]{3}$/

type CreateUserBody = {
  email?: string
  password?: string
  fullName?: string
  /** null = "bez obce" (sees events from every municipality). */
  municipality?: number | null
  dateOfBirth?: string | null
  gender?: (typeof GENDERS)[number]
  phone?: string | null
  interests?: number[]
}

/** Lets a platform superadmin provision an account directly (no self-service registration
 * flow). Collects the same data a self-signup gives across registration + onboarding (home obec
 * or "bez obce", date of birth, gender, phone, interests), so the account is complete and its
 * onboarding is marked done up front. */
export async function POST(request: Request) {
  const payload = await getPayload({ config })

  const { user: actor } = await payload.auth({ headers: request.headers })
  if (!actor || actor.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await request.json()) as CreateUserBody
  const email = body.email?.trim().toLowerCase()
  const fullName = body.fullName?.trim()
  const phone = body.phone?.trim() || null
  const municipality = body.municipality ? Number(body.municipality) : null

  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Zadejte platný e-mail.' }, { status: 400 })
  }
  if (!isValidPassword(body.password)) {
    return NextResponse.json({ error: 'Heslo musí mít alespoň 8 znaků.' }, { status: 400 })
  }
  if (!fullName || fullName.length < 2) {
    return NextResponse.json({ error: 'Zadejte celé jméno.' }, { status: 400 })
  }
  if (body.gender && !GENDERS.includes(body.gender)) {
    return NextResponse.json({ error: 'Neplatné pohlaví.' }, { status: 400 })
  }
  if (phone && !PHONE_RE.test(phone)) {
    return NextResponse.json({ error: 'Zadejte platné české telefonní číslo.' }, { status: 400 })
  }
  if (body.dateOfBirth && Number.isNaN(new Date(body.dateOfBirth).getTime())) {
    return NextResponse.json({ error: 'Neplatné datum narození.' }, { status: 400 })
  }

  let createdUserId: number | null = null
  try {
    const newUser = await payload.create({
      collection: 'users',
      data: { email, password: body.password, role: 'user' },
      overrideAccess: true,
    })
    createdUserId = newUser.id

    await payload.create({
      collection: 'profiles',
      data: {
        user: newUser.id,
        fullName,
        municipality,
        dateOfBirth: body.dateOfBirth || null,
        gender: body.gender ?? 'neuvedeno',
        phone,
        interests: (body.interests ?? []).map(Number).filter(Number.isInteger),
        // Done when the superadmin filled in what onboarding requires; otherwise the user completes
        // the missing bits on first login (onboarding is prefilled with what's already here).
        onboardingCompleted: Boolean(body.dateOfBirth && phone),
      },
      overrideAccess: true,
    })

    if (municipality) {
      await payload.create({
        collection: 'user-roles',
        data: { user: newUser.id, municipality, role: 'participant' },
        overrideAccess: true,
      })
    }

    return NextResponse.json({ id: newUser.id, email: newUser.email }, { status: 201 })
  } catch (error) {
    console.error('[superadmin/create-user] failed', error)
    // Don't leave a half-created account (user without a profile) behind.
    if (createdUserId) {
      await payload.delete({ collection: 'users', id: createdUserId, overrideAccess: true }).catch(() => {})
    }
    return NextResponse.json({ error: 'Nepodařilo se vytvořit uživatele — e-mail už možná existuje.' }, { status: 500 })
  }
}
