import { escapeHtml, sendNotification } from '@/collections/shared/notify'
import { upsertUser } from '@/lib/auth/users'

import { importGoogleAvatar } from './avatar'

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
    // Identities from before photos existed get theirs on the next sign-in.
    if (!identity.avatarImportedAt) await importGoogleAvatar(payload, identity.id, user.id, profile)

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

  const created = await payload.create({
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
  await importGoogleAvatar(payload, created.id, user.id, profile)

  return { ok: true, user, linked: linkedToExistingAccount }
}

export type GoogleLinkResult =
  | { ok: true; alreadyLinked: boolean }
  | { ok: false; reason: 'linked-to-another-account' | 'already-has-google' }

/**
 * Attaches a Google identity to an account that is already signed in — the "Připojit Google"
 * button on the profile. Different rules from sign-in, on purpose:
 *
 * - The address doesn't have to match the account's, nor be verified: the person is already in
 *   the account and proved they hold the Google account by signing in to it. The `sub` is what
 *   later sign-ins key on, not the address.
 * - A `sub` that already belongs to another account stays there. Moving it would let whoever holds
 *   a session here take over that account's Google sign-in.
 * - One Google account per Lonvita account from here; changing it means unlinking first.
 *
 * The owner hears about it, since a new way into the account is exactly what someone holding a
 * stolen session would add.
 */
export async function linkGoogleToUser(
  payload: Payload,
  userId: number,
  profile: GoogleProfile,
): Promise<GoogleLinkResult> {
  const bySubject = await payload.find({
    collection: 'auth-identities',
    where: { and: [{ provider: { equals: 'google' } }, { providerSubject: { equals: profile.providerSubject } }] },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  const existing = bySubject.docs[0]
  if (existing) {
    const ownerId = typeof existing.user === 'object' ? existing.user.id : existing.user
    return ownerId === userId ? { ok: true, alreadyLinked: true } : { ok: false, reason: 'linked-to-another-account' }
  }

  const own = await payload.count({
    collection: 'auth-identities',
    where: { and: [{ provider: { equals: 'google' } }, { user: { equals: userId } }] },
    overrideAccess: true,
  })
  if (own.totalDocs > 0) return { ok: false, reason: 'already-has-google' }

  const created = await payload.create({
    collection: 'auth-identities',
    data: {
      user: userId,
      provider: 'google',
      providerSubject: profile.providerSubject,
      providerType: 'social',
      email: profile.email,
      emailVerified: profile.emailVerified,
      lastSyncedAt: new Date().toISOString(),
    },
    overrideAccess: true,
  })
  await importGoogleAvatar(payload, created.id, userId, profile)

  const which = profile.email ? ` ${profile.email}` : ''
  await sendNotification(payload, {
    userId,
    title: 'Google účet připojen',
    message: `K vašemu účtu byl připojen Google účet${which}. Pokud jste to nebyli vy, odpojte ho v profilu a změňte si heslo.`,
    link: '/profil',
    email: {
      subject: 'K vašemu účtu Lonvita byl připojen Google účet',
      body:
        `<p>K vašemu účtu na Lonvitě byl připojen Google účet${escapeHtml(which)} — přihlásit se teď můžete i přes Google.</p>` +
        `<p>Pokud jste to nebyli vy, odpojte ho prosím v profilu a změňte si heslo.</p>`,
    },
  })

  return { ok: true, alreadyLinked: false }
}
