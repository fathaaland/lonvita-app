import { upsertUser } from '@/lib/auth/users'

import type { GoogleProfile } from './provider'
import type { Payload } from 'payload'
import type { User } from '@/payload-types'

/**
 * Turns a Google profile into a Lonvita account. This is where the whole flow's security
 * actually lives, so the rules are explicit rather than implied:
 *
 * 1. A known `sub` logs straight in. The subject id is the account key, not the address —
 *    an address can be reassigned inside a Workspace domain, `sub` cannot.
 * 2. An unknown `sub` may only reach an existing account when Google says the address is
 *    verified. Without that check, anyone who can set an arbitrary unverified address at any
 *    provider could walk into the matching Lonvita account.
 * 3. No verified address means no account at all — neither linked nor created.
 */

export type GoogleSignInResult =
  | { ok: true; user: User; linked: boolean }
  | { ok: false; reason: 'no-email' | 'email-unverified' }

export async function resolveGoogleUser(payload: Payload, profile: GoogleProfile): Promise<GoogleSignInResult> {
  const existing = await payload.find({
    collection: 'auth-identities',
    where: { and: [{ provider: { equals: 'google' } }, { providerSubject: { equals: profile.providerSubject } }] },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })

  const identity = existing.docs[0]
  if (identity) {
    const userId = typeof identity.user === 'object' ? identity.user.id : identity.user
    const user = await payload.findByID({ collection: 'users', id: userId, overrideAccess: true })

    await payload.update({
      collection: 'auth-identities',
      id: identity.id,
      data: {
        email: profile.email,
        emailVerified: profile.emailVerified,
        lastLoginAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })

    return { ok: true, user, linked: false }
  }

  if (!profile.email) return { ok: false, reason: 'no-email' }
  if (!profile.emailVerified) return { ok: false, reason: 'email-unverified' }

  // Whether this is a link or a fresh sign-up has to be read before the upsert, not inferred
  // from the row afterwards.
  const byEmail = await payload.find({
    collection: 'users',
    where: { email: { equals: profile.email } },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  const linkedToExistingAccount = byEmail.docs.length > 0

  // Find-or-create by address, profile row included — the same path every other sign-up uses.
  const user = await upsertUser({ payload, email: profile.email, fullName: profile.fullName ?? undefined })

  await payload.create({
    collection: 'auth-identities',
    data: {
      user: user.id,
      provider: 'google',
      providerSubject: profile.providerSubject,
      providerType: 'social',
      email: profile.email,
      emailVerified: profile.emailVerified,
      lastLoginAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
    },
    overrideAccess: true,
  })

  return { ok: true, user, linked: linkedToExistingAccount }
}
