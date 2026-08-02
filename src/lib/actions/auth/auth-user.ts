'use server'

import { cache } from 'react'
import { getPayload } from 'payload'

import config from '@payload-config'
import { auth0 } from '@/lib/auth/auth0/client'
import { upsertUser } from '@/lib/auth/users'

type UpsertAuthIdentityParams = {
  userId: number
  providerSubject: string
  provider: string
  email: string
  emailVerified: boolean
  profile: unknown
}

const upsertAuthIdentity = async ({
  userId,
  providerSubject,
  provider,
  email,
  emailVerified,
  profile,
}: UpsertAuthIdentityParams) => {
  const payload = await getPayload({ config })

  const existing = await payload.find({
    collection: 'auth-identities',
    where: { providerSubject: { equals: providerSubject } },
    limit: 1,
    overrideAccess: true,
  })

  const data = {
    user: userId,
    providerSubject,
    provider,
    email,
    emailVerified,
    profile,
    lastLoginAt: new Date().toISOString(),
    lastSyncedAt: new Date().toISOString(),
  }

  if (existing.docs[0]) {
    return payload.update({
      collection: 'auth-identities',
      id: existing.docs[0].id,
      data,
      overrideAccess: true,
    })
  }

  return payload.create({
    collection: 'auth-identities',
    data,
    overrideAccess: true,
  })
}

/**
 * The primary "am I logged in" entry point for the app. Reads the live Auth0 session,
 * find-or-creates the matching Payload user + auth-identity, and returns the Payload user.
 * Re-runs on every authenticated request (deduplicated per-request via React's cache()) so
 * the Payload user stays in sync with the live Auth0 session.
 */
export const authenticateUser = cache(async () => {
  try {
    const session = await auth0.getSession()
    if (!session) return { user: null }

    const email = session.user.email?.toLowerCase()
    if (!email) return { user: null }

    const payload = await getPayload({ config })
    const provider = session.user.sub.split('|')[0] ?? 'auth0'

    const user = await upsertUser({ payload, email })

    await upsertAuthIdentity({
      userId: user.id,
      providerSubject: session.user.sub,
      provider,
      email,
      emailVerified: Boolean(session.user.email_verified),
      profile: session.user,
    })

    return { user }
  } catch (error) {
    console.error('[authenticateUser] failed', error)
    return { user: null }
  }
})

export async function getCurrentUser() {
  const { user } = await authenticateUser()
  return user
}
