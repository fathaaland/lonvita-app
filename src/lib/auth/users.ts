import type { Payload } from 'payload'

import type { User } from '@/payload-types'

type UpsertUserParams = {
  payload: Payload
  email: string
  /** Best-effort display name for a brand-new Profile (e.g. Google's `name` claim) —
   * only used the first time this email is seen; falls back to the email's local part. */
  fullName?: string
}

/**
 * Find-or-create the Profile for a given Payload user — every `users` row is meant to have
 * exactly one (Profiles.user is `unique: true`), but the self-registration route is the only
 * place that used to create both together. A user who first authenticates via Google (e.g.
 * "Přihlásit se přes Google" without ever going through the /auth sign-up form) got a `users`
 * row here with no matching `profiles` row — `profile` then stayed `null` forever, which reads
 * identically to "signed-out visitor" everywhere `!!profile` gates onboarding (RequireAuth,
 * the home page), so the dashboard rendered instead of redirecting to /onboarding, and
 * /onboarding's own submit silently no-ops without a profile id to update. Self-healing this
 * here — the single choke point every auth entry point already calls into — fixes both.
 */
const ensureProfile = async (payload: Payload, user: User, fullName?: string): Promise<void> => {
  const existing = await payload.find({
    collection: 'profiles',
    where: { user: { equals: user.id } },
    limit: 1,
    overrideAccess: true,
  })
  if (existing.docs[0]) return

  await payload.create({
    collection: 'profiles',
    data: {
      user: user.id,
      fullName: fullName?.trim() || user.email.split('@')[0],
      municipality: null,
    },
    overrideAccess: true,
  })
}

/**
 * Find-or-create the Payload user for a given (already-verified) email.
 *
 * Unlike hbai-app's version, this does not assign a tenant/municipality — Lonvita users
 * pick their municipality explicitly when they create their Profile (registration flow),
 * not implicitly from their email domain or an SSO claim.
 */
export const upsertUser = async ({ payload, email, fullName }: UpsertUserParams): Promise<User> => {
  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })

  let user = existing.docs[0]
  if (!user) {
    try {
      user = await payload.create({
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
      if (!retry.docs[0]) throw error
      user = retry.docs[0]
    }
  }

  await ensureProfile(payload, user, fullName)
  return user
}
