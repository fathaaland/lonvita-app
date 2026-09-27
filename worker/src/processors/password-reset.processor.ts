import { logger } from '@/lib/logger'

import { getWorkerPayload } from '../runtime/payload'
import { processEmailJob } from './email.processor'

import type { PasswordResetJobData, PasswordResetJobResult } from '@/lib/queue/contracts'

type DispatchContext = {
  jobId?: string
  attemptsMade?: number
}

const buildResetPasswordEmailHtml = (resetUrl: string): string => `
  <p>Dostali jsme žádost o obnovení hesla k vašemu účtu na Lonvitě.</p>
  <p><a href="${resetUrl}" style="display:inline-block;padding:10px 20px;background:#5B3A8E;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">Nastavit nové heslo</a></p>
  <p>Nebo otevřete tento odkaz: <a href="${resetUrl}">${resetUrl}</a></p>
  <p style="color:#666;font-size:13px;">Odkaz je platný 1 hodinu. Pokud jste o obnovení hesla nežádali, tento e-mail můžete ignorovat — vaše heslo zůstane beze změny.</p>
`

/**
 * Mints the reset token and e-mails the link — or, for an address with no account, does nothing
 * but log it. The e-mail goes straight to Resend from here rather than through a send-email job,
 * so the link (a bearer credential for an hour) never sits in Redis with the finished job.
 *
 * A failed send fails the job and the retry mints a fresh token, which simply replaces the one
 * that never arrived.
 */
export const processPasswordResetJob = async (
  data: PasswordResetJobData,
  context: DispatchContext = {},
): Promise<PasswordResetJobResult> => {
  const payload = await getWorkerPayload()

  // null for an address nobody registered (Payload stays silent on purpose); anything thrown is
  // a real failure and retries the job.
  const token = await payload.forgotPassword({
    collection: 'users',
    overrideAccess: true,
    disableEmail: true,
    data: { email: data.email },
  })
  if (!token) {
    // Recorded at info because a sudden run of these is how account enumeration looks from
    // the inside.
    logger.info('Forgot password rejected', {
      event: 'auth.forgot_password_rejected',
      reason: 'no_matching_account',
      userEmail: data.email,
    })
    return { sent: false, skipped: 'no_matching_account' }
  }

  const resetUrl = `${data.appUrl}/reset-password?token=${encodeURIComponent(token)}`
  const { messageId } = await processEmailJob(
    { to: data.email, subject: 'Obnovení hesla — Lonvita', body: buildResetPasswordEmailHtml(resetUrl) },
    context,
  )

  logger.info('Forgot password e-mail sent', {
    event: 'auth.forgot_password_email_sent',
    userEmail: data.email,
    jobId: context.jobId,
    messageId,
  })
  return { sent: true, messageId }
}
