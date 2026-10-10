import { UnrecoverableError } from 'bullmq'

import { logger } from '@/lib/logger'

import type { SmsJobData } from '@/lib/queue/contracts'

type QueueJobContext = {
  jobId?: string
  attemptsMade?: number
}

/**
 * Sent through Twilio's Messages API — only ever "akce byla zrušena" (see sendSmsToMany):
 *   POST https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json
 *   auth:  HTTP Basic, account SID + auth token
 *   body:  form-encoded To, Body and either MessagingServiceSid or From
 * `TWILIO_MESSAGING_SERVICE_SID` wins when set; otherwise `TWILIO_FROM` is a Twilio number
 * (E.164) or an alphanumeric sender ID like "Lonvita" where the destination country allows one.
 *
 * Twilio has no idempotency key, so a retry after a send that went through but whose answer got
 * lost could text someone twice — rare, and better than not telling them at all. What retrying
 * can't fix (missing configuration, a rejected number or sender, bad credentials) fails the job
 * straight away instead of three times.
 */
const TWILIO_API = 'https://api.twilio.com/2010-04-01'

type TwilioMessage = { sid?: string; status?: string }
type TwilioError = { code?: number; message?: string; more_info?: string }

export const processSmsJob = async (payload: SmsJobData, context?: QueueJobContext): Promise<void> => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
  const from = process.env.TWILIO_FROM
  if (!accountSid || !authToken || !(messagingServiceSid || from)) {
    throw new UnrecoverableError(
      'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM are not set - cannot send SMS',
    )
  }

  logger.info('SMS send started', {
    event: 'sms.send_started',
    jobId: context?.jobId,
    to: payload.to,
    attempt: (context?.attemptsMade ?? 0) + 1,
  })

  // A trial account only sends Twilio's own predefined templates (error 572006 otherwise), so
  // TWILIO_TRIAL_TEMPLATE (e.g. "sms_event_notifications") replaces our text until the upgrade.
  const trialTemplate = process.env.TWILIO_TRIAL_TEMPLATE
  const form = new URLSearchParams({ To: payload.to, Body: trialTemplate || payload.message })
  if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid)
  else form.set('From', from!)

  const res = await fetch(`${TWILIO_API}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as TwilioError
    // 429 and 5xx are worth another try; any other 4xx (unknown or landline number, sender not
    // allowed in that country, bad credentials) will be rejected again just the same.
    const retryable = res.status === 429 || res.status >= 500
    logger.error('SMS send rejected', {
      event: 'sms.send_rejected',
      jobId: context?.jobId,
      to: payload.to,
      status: res.status,
      providerErrorCode: body.code,
      providerError: body.message,
      moreInfo: body.more_info,
      retryable,
    })
    const message = `Twilio error ${res.status}${body.code ? ` (${body.code})` : ''}: ${body.message ?? 'no details'}`
    throw retryable ? new Error(message) : new UnrecoverableError(message)
  }

  const sent = (await res.json().catch(() => ({}))) as TwilioMessage
  logger.info('SMS send succeeded', {
    event: 'sms.send_succeeded',
    jobId: context?.jobId,
    to: payload.to,
    messageSid: sent.sid,
    providerStatus: sent.status,
  })
}
