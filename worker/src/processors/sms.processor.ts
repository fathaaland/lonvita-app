import { UnrecoverableError } from 'bullmq'

import { logger, serializeError } from '@/lib/logger'

import { getWorkerPayload } from '../runtime/payload'

import type { SmsJobData } from '@/lib/queue/contracts'

type QueueJobContext = {
  jobId?: string
  attemptsMade?: number
}

/**
 * Sent through BulkGate's Simple API — only ever "akce byla zrušena" (see sendSmsToMany):
 *   POST https://portal.bulkgate.com/api/1.0/simple/transactional
 *   body: JSON application_id, application_token, number, text, unicode, sender_id(_value)
 * `BULKGATE_SENDER_ID` is the sender type (gSystem = BulkGate's own number, the default; gText =
 * an alphanumeric sender like "Lonvita"; gOwn = a verified own number; gProfile = a profile id)
 * and `BULKGATE_SENDER_ID_VALUE` its value. Czech text needs `unicode` for the diacritics.
 *
 * `duplicates_check: on` makes BulkGate drop the same text to the same number within 5 minutes, so
 * a retry after a send that went through but whose answer got lost doesn't text anyone twice. What
 * retrying can't fix (missing configuration, a rejected number, bad credentials, no credit) fails
 * the job straight away instead of three times.
 */
const BULKGATE_API = 'https://portal.bulkgate.com/api/1.0/simple/transactional'

type BulkGateSuccess = { data?: { status?: string; sms_id?: string; number?: string } }
type BulkGateError = { type?: string; code?: number; error?: string; detail?: unknown }

export const processSmsJob = async (payload: SmsJobData, context?: QueueJobContext): Promise<void> => {
  const applicationId = process.env.BULKGATE_APPLICATION_ID
  const applicationToken = process.env.BULKGATE_APPLICATION_TOKEN
  if (!applicationId || !applicationToken) {
    throw new UnrecoverableError(
      'BULKGATE_APPLICATION_ID / BULKGATE_APPLICATION_TOKEN are not set - cannot send SMS',
    )
  }
  const senderId = process.env.BULKGATE_SENDER_ID || 'gSystem'
  const senderIdValue = process.env.BULKGATE_SENDER_ID_VALUE

  logger.info('SMS send started', {
    event: 'sms.send_started',
    jobId: context?.jobId,
    to: payload.to,
    attempt: (context?.attemptsMade ?? 0) + 1,
  })

  const res = await fetch(BULKGATE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      application_id: applicationId,
      application_token: applicationToken,
      // toE164 gives "+420…"; BulkGate takes the international number without the plus.
      number: payload.to.replace(/^\+/, ''),
      text: payload.message,
      unicode: true,
      sender_id: senderId,
      ...(senderIdValue ? { sender_id_value: senderIdValue } : {}),
      duplicates_check: 'on',
      ...(payload.requestId ? { tag: payload.requestId } : {}),
    }),
  })

  const body = (await res.json().catch(() => ({}))) as BulkGateSuccess & BulkGateError
  if (!res.ok || !body.data) {
    // 429 and 5xx are worth another try; any other 4xx (invalid number, unknown identity, no
    // credit, sender not allowed) will be rejected again just the same.
    const retryable = res.status === 429 || res.status >= 500
    logger.error('SMS send rejected', {
      event: 'sms.send_rejected',
      jobId: context?.jobId,
      to: payload.to,
      status: res.status,
      providerErrorCode: body.type,
      providerError: body.error,
      providerErrorDetail: body.detail,
      retryable,
    })
    const message = `BulkGate error ${res.status}${body.type ? ` (${body.type})` : ''}: ${body.error ?? 'no details'}`
    throw retryable ? new Error(message) : new UnrecoverableError(message)
  }

  const sent = body.data
  logger.info('SMS send succeeded', {
    event: 'sms.send_succeeded',
    jobId: context?.jobId,
    to: payload.to,
    messageSid: sent.sms_id,
    providerStatus: sent.status,
  })

  // Counted against the obec's monthly SMS. Sent is sent: a failed write is logged, not retried —
  // a retry would text the person again.
  if (payload.municipalityId !== undefined) {
    try {
      const db = await getWorkerPayload()
      await db.create({
        collection: 'sms-messages',
        data: { municipality: payload.municipalityId, requestId: payload.requestId, providerMessageSid: sent.sms_id },
        overrideAccess: true,
      })
    } catch (error) {
      logger.error('SMS not recorded', {
        event: 'sms.record_failed',
        jobId: context?.jobId,
        municipalityId: payload.municipalityId,
        ...serializeError(error),
      })
    }
  }
}
