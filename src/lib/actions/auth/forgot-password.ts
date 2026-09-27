'use server'

import { enqueuePasswordReset } from '@/lib/queue/queues'
import { forgotPasswordInputSchema } from '@/lib/auth/password-reset-schema'
import { logger, serializeError } from '@/lib/logger'
import { correlationIdFromHeaders } from '@/lib/logger/correlation'
import { enforcePasswordResetRateLimit } from '@/lib/security/rate-limit'

type ForgotPasswordInput = {
  email: string
  appUrl: string
  requestHeaders: { get: (name: string) => string | null }
}

/** Always resolves (never leaks whether the e-mail exists) — the caller shows the same
 * "check your inbox" message regardless. Nothing here depends on whether the account exists:
 * the lookup, the token and the e-mail all happen in the worker's password-reset job, so the
 * response time doesn't give it away either. */
export async function forgotPasswordAction({ email, appUrl, requestHeaders }: ForgotPasswordInput): Promise<void> {
  // Every branch below returns void so the response never reveals whether the account exists.
  // That silence is for the caller, not for us: the log records which branch was taken, or a
  // request that produced no e-mail is indistinguishable from one that worked.
  const correlationId = correlationIdFromHeaders(requestHeaders)

  const parsed = forgotPasswordInputSchema.safeParse({ email })
  if (!parsed.success) {
    logger.info('Forgot password rejected', {
      event: 'auth.forgot_password_rejected',
      reason: 'invalid_email',
      correlationId,
    })
    return
  }

  const rateLimit = await enforcePasswordResetRateLimit({
    operation: 'forgot-password',
    requestHeaders,
    email: parsed.data.email,
  })
  if (!rateLimit.allowed) {
    logger.warn('Forgot password rejected', {
      event: 'auth.forgot_password_rejected',
      reason: 'rate_limited',
      userEmail: parsed.data.email,
      retryAfter: rateLimit.retryAfter,
      correlationId,
    })
    return
  }

  try {
    const job = await enqueuePasswordReset({ email: parsed.data.email, appUrl }, { correlationId })

    logger.info('Forgot password queued', {
      event: 'auth.forgot_password_queued',
      userEmail: parsed.data.email,
      jobId: job.id,
      correlationId,
    })
  } catch (error) {
    // A queue outage fails every request alike — with or without an account — so letting the
    // caller see it doesn't tell them anything about the address.
    logger.error('Forgot password enqueue failed', {
      event: 'auth.forgot_password_enqueue_failed',
      userEmail: parsed.data.email,
      ...serializeError(error),
      correlationId,
    })
    throw error
  }
}
