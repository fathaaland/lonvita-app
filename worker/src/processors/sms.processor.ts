import { logger } from '@/lib/logger'

import type { SmsJobData } from '@/lib/queue/contracts'

type QueueJobContext = {
  jobId?: string
  attemptsMade?: number
}

/**
 * Brief §8 "oznámení o změně/zrušení musí jít přes SMS/mail" — sent via httpSMS
 * (https://httpsms.com), which relays through a paired Android phone's own SIM card instead
 * of a paid SMS gateway account. Verified API contract (2026-09):
 *   POST https://api.httpsms.com/v1/messages/send
 *   header: x-api-key: <key>
 *   body:   { from, to, content, request_id? }
 * `HTTPSMS_FROM_NUMBER` is the phone number of the paired Android device (E.164, e.g.
 * "+420601234567" — set it up at https://httpsms.com by installing their Android app and
 * pairing it with an API key from https://httpsms.com/settings).
 */
const HTTPSMS_ENDPOINT = 'https://api.httpsms.com/v1/messages/send'

export const processSmsJob = async (payload: SmsJobData, context?: QueueJobContext): Promise<void> => {
  const apiKey = process.env.HTTPSMS_API_KEY
  const fromNumber = process.env.HTTPSMS_FROM_NUMBER
  if (!apiKey || !fromNumber) {
    throw new Error('HTTPSMS_API_KEY / HTTPSMS_FROM_NUMBER is not set - cannot send SMS')
  }

  logger.info('SMS send started', {
    event: 'sms.send_started',
    jobId: context?.jobId,
    to: payload.to,
    attempt: (context?.attemptsMade ?? 0) + 1,
  })

  const res = await fetch(HTTPSMS_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromNumber,
      to: payload.to,
      content: payload.message,
      ...(payload.requestId ? { request_id: payload.requestId } : {}),
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    logger.error('SMS send rejected', {
      event: 'sms.send_rejected',
      jobId: context?.jobId,
      to: payload.to,
      status: res.status,
      body,
    })
    throw new Error(`httpSMS error ${res.status}: ${body}`)
  }

  logger.info('SMS send succeeded', {
    event: 'sms.send_succeeded',
    jobId: context?.jobId,
    to: payload.to,
  })
}
