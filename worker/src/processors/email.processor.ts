import { Resend } from 'resend'

import { logger } from '@/lib/logger'

import type { EmailJobData, EmailJobResult } from '@/lib/queue/contracts'

type QueueJobContext = {
  jobId?: string
  attemptsMade?: number
}

let resendClient: Resend | null = null

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

  logger.info('email.send_started', {
    event: 'email.send_started',
    jobId: context?.jobId,
    subject,
    to: recipients,
    from: fromAddress,
    attempt: (context?.attemptsMade ?? 0) + 1,
  })

  const resend = getResendClient()
  const { data, error } = await resend.emails.send({
    from: fromAddress,
    to: recipients,
    subject,
    html: body,
    ...(replyTo ? { reply_to: replyTo } : {}),
  })

  if (error) {
    // Carries `from` because the rejections that actually happen are about the sender: an
    // unverified domain, or a sandboxed account that may only write to its own owner.
    logger.error('email.send_rejected', {
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
    logger.error('email.send_without_message_id', {
      event: 'email.send_without_message_id',
      jobId: context?.jobId,
      subject,
      to: recipients,
    })
    throw new Error('Resend returned no message ID - treating as failure')
  }

  logger.info('email.send_succeeded', {
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
