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

  logger.info('[EmailWorker] Processing job', {
    jobId: context?.jobId,
    subject,
    to: recipients,
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
    logger.error('[EmailWorker] Resend rejected the request', {
      jobId: context?.jobId,
      subject,
      to: recipients,
      error: error.message,
    })
    throw new Error(`Resend error: ${error.message}`)
  }

  if (!data?.id) {
    throw new Error('Resend returned no message ID - treating as failure')
  }

  logger.info('[EmailWorker] Email sent successfully', {
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
