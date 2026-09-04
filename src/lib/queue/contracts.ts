export const QUEUE_NAME = 'lonvita' as const

export const JOB_NAMES = {
  SEND_EMAIL: 'send-email',
  PUSH_NOTIFICATION: 'push-notification',
  SEND_SMS: 'send-sms',
} as const

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES]

export type EmailJobData = {
  to: string | string[]
  subject: string
  body: string
  replyTo?: string
  from?: string
}

export type EmailJobResult = {
  messageId: string
  accepted: string[]
}

export type NotificationJobData = {
  userId: string
  type: 'info' | 'warning' | 'error'
  title: string
  message: string
}

/**
 * Brief §8 "Webová aplikace, tudíž oznámení o změně/zrušení musí jít přes SMS/mail" — sent
 * via httpSMS (https://httpsms.com), which relays through a paired Android phone's own SIM
 * instead of a paid SMS gateway account (free tier: 200 SMS/month on one phone). `requestId`
 * makes retries idempotent on httpSMS's side (their API dedupes on it).
 */
export type SmsJobData = {
  to: string
  message: string
  requestId?: string
}

export type QueueJobEnvelope =
  | { jobType: typeof JOB_NAMES.SEND_EMAIL; payload: EmailJobData }
  | { jobType: typeof JOB_NAMES.PUSH_NOTIFICATION; payload: NotificationJobData }
  | { jobType: typeof JOB_NAMES.SEND_SMS; payload: SmsJobData }
