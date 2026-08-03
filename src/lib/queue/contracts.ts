export const QUEUE_NAME = 'lonvita' as const

export const JOB_NAMES = {
  SEND_EMAIL: 'send-email',
  PUSH_NOTIFICATION: 'push-notification',
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

export type QueueJobEnvelope =
  | { jobType: typeof JOB_NAMES.SEND_EMAIL; payload: EmailJobData }
  | { jobType: typeof JOB_NAMES.PUSH_NOTIFICATION; payload: NotificationJobData }
