'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

import type { Payload } from 'payload'

import { resetPasswordInputSchema } from '@/lib/auth/password-reset-schema'
import { logger, serializeError } from '@/lib/logger'
import { correlationIdFromHeaders } from '@/lib/logger/correlation'
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

/** Whether the link can still be redeemed — the same test Payload's resetPassword applies, so the
 * page can say "expired" up front instead of after the user has typed a new password twice. */
export async function isResetTokenValid(token: string): Promise<boolean> {
  const parsed = resetPasswordInputSchema.shape.token.safeParse(token)
  if (!parsed.success) return false

  const payload = await getPayload({ config })
  const user = await payload.db.findOne({
    collection: 'users',
    where: {
      resetPasswordToken: { equals: parsed.data },
      resetPasswordExpiration: { greater_than: new Date().toISOString() },
    },
  })
  return Boolean(user)
}

/** Resets the password. Payload owns both the token and the hash, so there is nothing to keep
 * in step anywhere else — an account linked to Google simply keeps signing in with Google. */
export async function resetPasswordAction({ token, password, requestHeaders }: ResetPasswordInput): Promise<ResetPasswordResult> {
  const correlationId = correlationIdFromHeaders(requestHeaders)

  const parsed = resetPasswordInputSchema.safeParse({ token, password })
  if (!parsed.success) {
    logger.info('Password reset failed', {
      event: 'auth.password_reset_failed',
      reason: 'invalid_input',
      correlationId,
    })
    return { success: false, error: GENERIC_ERROR }
  }

  const rateLimit = await enforcePasswordResetRateLimit({ operation: 'reset-password', requestHeaders })
  if (!rateLimit.allowed) {
    logger.warn('Password reset failed', {
      event: 'auth.password_reset_failed',
      reason: 'rate_limited',
      retryAfter: rateLimit.retryAfter,
      correlationId,
    })
    return { success: false, error: 'Příliš mnoho pokusů. Vyžádejte si prosím nový odkaz později.' }
  }

  const payload = await getPayload({ config })

  try {
    const result = await payload.resetPassword({
      collection: 'users',
      overrideAccess: true,
      data: { token: parsed.data.token, password: parsed.data.password },
    })

    const user = result.user as { id?: number | string; email?: string }
    if (user.id !== undefined) {
      await invalidateResetToken(payload, user.id)
    }

    logger.info('Password reset succeeded', {
      event: 'auth.password_reset_succeeded',
      userId: user.id,
      userEmail: user.email,
      correlationId,
    })

    return { success: true }
  } catch (error) {
    // A spent or forged token looks exactly like a mistyped one from here, so this stays at
    // warn: a single line is noise, a run of them against one address is an attack.
    logger.warn('Password reset failed', {
      event: 'auth.password_reset_failed',
      reason: 'token_rejected',
      ...serializeError(error),
      correlationId,
    })
    return { success: false, error: GENERIC_ERROR }
  }
}
