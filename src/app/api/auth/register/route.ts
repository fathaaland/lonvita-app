import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { isValidEmail, isValidPassword } from '@/lib/validation'

const CONSENT_VERSION = '1.0'

type RegisterBody = {
  email?: string
  password?: string
  passwordConfirm?: string
  fullName?: string
  /** Picked on the map; omitted/null together with `noMunicipality: true` ("bez obce"). */
  municipality?: string | null
  noMunicipality?: boolean
  consentAccepted?: boolean
  marketingConsent?: boolean
}

const validate = (body: RegisterBody): string | null => {
  if (!isValidEmail(body.email)) {
    return 'Please provide a valid email address.'
  }
  if (!isValidPassword(body.password)) {
    return 'Password must be at least 8 characters.'
  }
  if (body.password !== body.passwordConfirm) {
    return 'Passwords do not match.'
  }
  if (!body.fullName || body.fullName.trim().length < 2) {
    return 'Please provide your full name.'
  }
  if (!body.municipality && !body.noMunicipality) {
    return 'Please choose your municipality.'
  }
  if (!body.consentAccepted) {
    return 'You must agree to the terms to create an account.'
  }
  return null
}

export async function POST(request: Request) {
  const body = (await request.json()) as RegisterBody
  const validationError = validate(body)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const email = body.email!.toLowerCase()
  const { password, fullName } = body as Required<Pick<RegisterBody, 'password' | 'fullName'>>
  // "Bez obce" — the user's town doesn't use Lonvita (yet); they see events from every obec.
  const municipality = body.municipality ? Number(body.municipality) : null
  const marketingConsent = Boolean(body.marketingConsent)

  const payload = await getPayload({ config })

  let createdPayloadUserId: number | null = null

  try {
    let payloadUser
    try {
      payloadUser = await payload.create({
        collection: 'users',
        // Payload is the only place a password lives, so this is the hash the user will log
        // in against.
        data: { email, password, role: 'user' },
        overrideAccess: true,
      })
      createdPayloadUserId = payloadUser.id
    } catch {
      // Duplicate-email race: reuse the existing user instead of failing.
      const existing = await payload.find({
        collection: 'users',
        where: { email: { equals: email } },
        limit: 1,
        overrideAccess: true,
      })
      if (!existing.docs[0]) throw new Error('Failed to create or find Payload user.')
      payloadUser = existing.docs[0]
    }

    await payload.create({
      collection: 'profiles',
      data: {
        user: payloadUser.id,
        fullName,
        municipality,
      },
      overrideAccess: true,
    })

    // Every registered user starts as a plain participant in their chosen municipality —
    // the admin role is granted later by a superadmin. "Bez obce" has no municipality to hold it in.
    if (municipality) {
      await payload.create({
        collection: 'user-roles',
        data: {
          user: payloadUser.id,
          municipality,
          role: 'participant',
        },
        overrideAccess: true,
      })
    }

    const grantedAt = new Date().toISOString()
    await payload.create({
      collection: 'consents',
      data: { user: payloadUser.id, type: 'platform_terms', version: CONSENT_VERSION, grantedAt },
      overrideAccess: true,
    })
    if (marketingConsent) {
      await payload.create({
        collection: 'consents',
        data: { user: payloadUser.id, type: 'marketing', version: CONSENT_VERSION, grantedAt },
        overrideAccess: true,
      })
    }

    return NextResponse.json({ redirectTo: '/auth?registered=true' }, { status: 201 })
  } catch (error) {
    console.error('[register] failed, rolling back', error)

    if (createdPayloadUserId) {
      await payload
        .delete({ collection: 'users', id: createdPayloadUserId, overrideAccess: true })
        .catch(() => {})
    }
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }
}
