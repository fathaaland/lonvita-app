export const QUEUE_NAME = 'lonvita' as const

export const JOB_NAMES = {
  SEND_EMAIL: 'send-email',
  SEND_SMS: 'send-sms',
  CLEANUP_NOTIFICATIONS: 'cleanup-notifications',
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

/**
 * Notifications pile up forever otherwise — nothing in the app ever deletes one (Notifications'
 * own access.delete is closed). Enqueued only by the worker's own scheduler, on a daily cron.
 */
export type CleanupNotificationsJobData = Record<string, never>

export type CleanupNotificationsJobResult = {
  deleted: number
}

export type QueueJobEnvelope =
  | { jobType: typeof JOB_NAMES.SEND_EMAIL; payload: EmailJobData }
  | { jobType: typeof JOB_NAMES.SEND_SMS; payload: SmsJobData }
  | { jobType: typeof JOB_NAMES.CLEANUP_NOTIFICATIONS; payload: CleanupNotificationsJobData }
