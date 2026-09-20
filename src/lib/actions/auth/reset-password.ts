'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

import { resetPasswordInputSchema } from '@/lib/auth/password-reset-schema'
import { enforcePasswordResetRateLimit } from '@/lib/security/rate-limit'
import { updateAuth0UserPassword } from '@/lib/auth/auth0/management'

type ResetPasswordInput = {
  token: string
  password: string
  requestHeaders: { get: (name: string) => string | null }
}

type ResetPasswordResult = { success: true } | { success: false; error: string }

const GENERIC_ERROR = 'Odkaz pro obnovení hesla je neplatný nebo vypršel. Vyžádejte si prosím nový.'

/** Resets the Payload-local password (source of truth for the token/expiry) and, when the
 * account also has an Auth0 database-connection identity, syncs the same password there too —
 * otherwise the reset would silently not let the user log back in via Auth0. */
export async function resetPasswordAction({ token, password, requestHeaders }: ResetPasswordInput): Promise<ResetPasswordResult> {
  const parsed = resetPasswordInputSchema.safeParse({ token, password })
  if (!parsed.success) {
    return { success: false, error: GENERIC_ERROR }
  }

  const rateLimit = await enforcePasswordResetRateLimit({ operation: 'reset-password', requestHeaders })
  if (!rateLimit.allowed) {
    return { success: false, error: 'Příliš mnoho pokusů. Vyžádejte si prosím nový odkaz později.' }
  }

  const payload = await getPayload({ config })

  try {
    const result = await payload.resetPassword({
      collection: 'users',
      overrideAccess: true,
      data: { token: parsed.data.token, password: parsed.data.password },
    })

    const userId = (result.user as { id?: number | string }).id
    if (userId !== undefined) {
      const identities = await payload.find({
        collection: 'auth-identities',
        where: { and: [{ user: { equals: userId } }, { providerType: { equals: 'database' } }] },
        limit: 1,
        overrideAccess: true,
      })
      const identity = identities.docs[0]
      if (identity) {
        await updateAuth0UserPassword(identity.providerSubject, parsed.data.password).catch(() => {})
      }
    }

    return { success: true }
  } catch {
    return { success: false, error: GENERIC_ERROR }
  }
}
