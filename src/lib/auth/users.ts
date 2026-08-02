import type { Payload } from 'payload'

import type { User } from '@/payload-types'

type UpsertUserParams = {
  payload: Payload
  email: string
}

/**
 * Find-or-create the Payload user for a given (already-verified) email.
 *
 * Unlike hbai-app's version, this does not assign a tenant/municipality — Lonvita users
 * pick their municipality explicitly when they create their Profile (registration flow),
 * not implicitly from their email domain or an SSO claim.
 */
export const upsertUser = async ({ payload, email }: UpsertUserParams): Promise<User> => {
  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })

  if (existing.docs[0]) {
    return existing.docs[0]
  }

  try {
    return await payload.create({
      collection: 'users',
      data: { email, role: 'user' },
      overrideAccess: true,
    })
  } catch (error) {
    // Race: another concurrent request created the same user between our find and create.
    const retry = await payload.find({
      collection: 'users',
      where: { email: { equals: email } },
      limit: 1,
      overrideAccess: true,
    })
    if (retry.docs[0]) return retry.docs[0]
    throw error
  }
}
