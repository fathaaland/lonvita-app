import { Resend } from 'resend'

import { logger } from '@/lib/logger'

import { ProviderRateLimitedError, withTimeout } from '../runtime/provider-errors'

import type { EmailJobData, EmailJobResult } from '@/lib/queue/contracts'

type QueueJobContext = {
  jobId?: string
  attemptsMade?: number
  /** Off for a send whose content changes between tries (a password reset mints a new token each
   * time — the first e-mail's link no longer works). */
  idempotent?: boolean
}

let resendClient: Resend | null = null

/** One send, however slow Resend is — a hung request would otherwise hold a slot of the queue. */
const SEND_TIMEOUT_MS = 20_000

function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not set - cannot send email')
    }
    resendClient = new Resend(apiKey)
  }

  return resendClient
}

function getFromAddress(from?: string): string {
  const resolved = from ?? process.env.RESEND_FROM_EMAIL
  if (!resolved) {
    throw new Error('RESEND_FROM_EMAIL is not set - cannot determine sender')
  }

  return resolved
}

function normalizeRecipients(to: string | string[]): string[] {
  return Array.isArray(to) ? to : [to]
}

export const processEmailJob = async (
  payload: EmailJobData,
  context?: QueueJobContext,
): Promise<EmailJobResult> => {
  const { to, subject, body, replyTo, from } = payload
  const recipients = normalizeRecipients(to)
  const fromAddress = getFromAddress(from)

  logger.info('E-mail send started', {
    event: 'email.send_started',
    jobId: context?.jobId,
    subject,
    to: recipients,
    from: fromAddress,
    attempt: (context?.attemptsMade ?? 0) + 1,
  })

  const resend = getResendClient()
  const { data, error } = await withTimeout(
    resend.emails.send(
      {
        from: fromAddress,
        to: recipients,
        subject,
        html: body,
        ...(replyTo ? { reply_to: replyTo } : {}),
      },
      // Resend keeps the key a day: a retry after a timeout or a worker restart mid-send — the
      // e-mail may have gone out already — is answered with the first send instead of a second one.
      context?.jobId && context.idempotent !== false ? { idempotencyKey: `lonvita-${context.jobId}` } : undefined,
    ),
    SEND_TIMEOUT_MS,
    'Resend',
  )

  if (error?.name === 'rate_limit_exceeded') {
    logger.warn('E-mail send throttled by Resend', { event: 'email.rate_limited', jobId: context?.jobId })
    throw new ProviderRateLimitedError(`Resend error: ${error.message}`, 2_000)
  }

  if (error) {
    // Carries `from` because the rejections that actually happen are about the sender: an
    // unverified domain, or a sandboxed account that may only write to its own owner.
    logger.error('E-mail send rejected', {
      event: 'email.send_rejected',
      jobId: context?.jobId,
      subject,
      to: recipients,
      from: fromAddress,
      providerError: error.message,
      providerErrorName: error.name,
    })
    throw new Error(`Resend error: ${error.message}`)
  }

  if (!data?.id) {
    logger.error('E-mail sent without a message ID', {
      event: 'email.send_without_message_id',
      jobId: context?.jobId,
      subject,
      to: recipients,
    })
    throw new Error('Resend returned no message ID - treating as failure')
  }

  logger.info('E-mail send succeeded', {
    event: 'email.send_succeeded',
    jobId: context?.jobId,
    subject,
    to: recipients,
    messageId: data.id,
  })

  return {
    messageId: data.id,
    accepted: recipients,
  }
}
