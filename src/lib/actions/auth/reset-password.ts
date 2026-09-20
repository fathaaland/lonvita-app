'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

import type { Payload } from 'payload'

import { resetPasswordInputSchema } from '@/lib/auth/password-reset-schema'
import { enforcePasswordResetRateLimit } from '@/lib/security/rate-limit'

type ResetPasswordInput = {
  token: string
  password: string
  requestHeaders: { get: (name: string) => string | null }
}

type ResetPasswordResult = { success: true } | { success: false; error: string }

const GENERIC_ERROR = 'Odkaz pro obnovení hesla je neplatný nebo vypršel. Vyžádejte si prosím nový.'

/**
 * Payload's own resetPassword stops a spent link from working by pushing its expiry back to
 * "now", but leaves the token itself sitting on the row. Wipe it: a redeemed credential has no
 * business staying at rest, and the link's one-time nature stops depending on an implementation
 * detail we don't own. Best-effort — the password is already changed by the time this runs, so a
 * failure here must not turn a successful reset into an error for the user.
 */
async function invalidateResetToken(payload: Payload, userId: number | string): Promise<void> {
  try {
    await payload.db.updateOne({
      collection: 'users',
      where: { id: { equals: userId } },
      data: { resetPasswordExpiration: null, resetPasswordToken: null },
    })
  } catch (error) {
    payload.logger.error({ err: error, userId }, 'Failed to clear a spent password-reset token')
  }
}

/** Resets the password. Payload owns both the token and the hash, so there is nothing to keep
 * in step anywhere else — an account linked to Google simply keeps signing in with Google. */
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
      await invalidateResetToken(payload, userId)
    }

    return { success: true }
  } catch {
    return { success: false, error: GENERIC_ERROR }
  }
}
