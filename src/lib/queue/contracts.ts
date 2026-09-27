export const QUEUE_NAME = 'lonvita' as const

export const JOB_NAMES = {
  SEND_EMAIL: 'send-email',
  SEND_SMS: 'send-sms',
  CLEANUP_NOTIFICATIONS: 'cleanup-notifications',
  FEEDBACK_REQUEST: 'feedback-request',
  GENERATE_EXPORT: 'generate-export',
  EXPORT_READY: 'export-ready',
  CLEANUP_EXPORTS: 'cleanup-exports',
  EVENT_UPDATED: 'event-updated',
  EVENT_CANCELLED: 'event-cancelled',
  PASSWORD_RESET: 'password-reset',
  SYNC_STATUSES: 'sync-statuses',
  ATTENDANCE_REMINDER: 'attendance-reminder',
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

/**
 * US-U-03 — "ohodnoťte akci" prompt for one participant the organizer marked as attended, delayed
 * until a while after the event ends. Carries only the id: the worker re-reads everything when it
 * fires, since attendance, the event's time or its cancellation may all have changed meanwhile.
 */
export type FeedbackRequestJobData = {
  registrationId: number | string
}

export type FeedbackRequestJobResult = {
  sent: boolean
  /** Why nothing was sent — for the job's log line. */
  skipped?: string
}

/**
 * Renders one row of the `exports` collection (a DOCX/PDF report or a CSV) and uploads it to S3.
 * Carries only the id: what to render, for whom and with which parameters lives on the row, which
 * the POST /api/exports route validated and access-checked before enqueueing.
 */
export type GenerateExportJobData = {
  exportId: number | string
}

export type GenerateExportJobResult = {
  generated: boolean
  skipped?: string
  bytes?: number
}

/**
 * Fired a little after an export finishes: if its owner still hasn't downloaded it (they closed
 * the dialog before it was ready), they get an in-app notification — and an e-mail, if they want
 * those — with the download link. Whoever downloaded it straight away hears nothing.
 */
export type ExportReadyJobData = {
  exportId: number | string
}

export type ExportReadyJobResult = {
  notified: boolean
  skipped?: string
}

/** Nightly: drops exports past their `expiresAt`, the S3 file together with the row. */
export type CleanupExportsJobData = Record<string, never>

export type CleanupExportsJobResult = {
  deleted: number
}

/**
 * Tells an event's registrants it was edited — in-app, e-mail and SMS. Enqueued from Events'
 * afterChange hook, i.e. before the edit commits, so it's delayed and carries only what the
 * notifiable fields looked like *before* the edit: the worker re-reads the event and diffs.
 * Debounced per event (see enqueueEventUpdated), so a burst of saves makes one notification
 * against the first save's baseline.
 */
export type EventUpdatedJobData = {
  eventId: number | string
  /** `comparable()` form of every notifiable field before the first edit of the burst. */
  before: Record<string, string>
}

export type EventUpdatedJobResult = {
  notified: number
  skipped?: string
}

/**
 * Tells an event's registrants it's off and drops their queued reminders. A snapshot rather than
 * an id: after a consented hard delete the event and its registrations no longer exist.
 */
export type EventCancelledJobData = {
  eventId: number | string
  title: string
  /** Pending/approved registrants to tell (the organizer excluded). */
  userIds: (number | string)[]
  /** Every registration of the event, whose reminder jobs have to go. */
  registrationIds: (number | string)[]
}

export type EventCancelledJobResult = {
  notified: number
  skipped?: string
}

/**
 * "Zapomenuté heslo" — the whole of it: finding the account, minting the token and sending the
 * link. The request only validates, rate-limits and enqueues this, the same for an address with
 * an account as for one without, so neither its response nor its timing says which it was. The
 * token never enters the queue: the worker mints it and hands the e-mail straight to Resend.
 */
export type PasswordResetJobData = {
  /** Already validated and lower-cased by forgotPasswordInputSchema. */
  email: string
  /** Base URL the reset link points at (the app the request came through). */
  appUrl: string
}

export type PasswordResetJobResult = {
  sent: boolean
  skipped?: string
  messageId?: string
}

/**
 * Every quarter of an hour: writes down the statuses that change with the clock alone — events
 * past their end become 'finished', deletion requests past their 24 h 'expired'. Reads already
 * derive both (the collections' afterRead hooks); this makes the stored value, which filters,
 * counts and the admin see, catch up. Enqueued only by the worker's own scheduler.
 */
export type SyncStatusesJobData = Record<string, never>

export type SyncStatusesJobResult = {
  eventsFinished: number
  deletionRequestsExpired: number
}

/**
 * Brief §4/§7 "Po skončení akce organizátorovi přijde upozornění, že má vyplnit docházku." —
 * delayed until a few hours after the event ends. Carries only the id: the worker re-reads the
 * event and its registrations when it fires, and skips the nudge if there's nothing left to fill
 * in (event cancelled or deleted, nobody approved, attendance already marked).
 */
export type AttendanceReminderJobData = {
  eventId: number | string
}

export type AttendanceReminderJobResult = {
  sent: boolean
  skipped?: string
  messageId?: string
}

/**
 * Carried on every job so a failure in the worker can be traced back to the web request that
 * produced it — the same id the proxy put on the original request. Without it the two halves
 * of a send ("user asked for a password reset" on Vercel, "Resend rejected it" on Railway) are
 * two unrelated log lines minutes apart.
 */
type Traced = { correlationId?: string }

export type QueueJobEnvelope =
  | ({ jobType: typeof JOB_NAMES.SEND_EMAIL; payload: EmailJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.SEND_SMS; payload: SmsJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.CLEANUP_NOTIFICATIONS; payload: CleanupNotificationsJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.FEEDBACK_REQUEST; payload: FeedbackRequestJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.GENERATE_EXPORT; payload: GenerateExportJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.EXPORT_READY; payload: ExportReadyJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.CLEANUP_EXPORTS; payload: CleanupExportsJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.EVENT_UPDATED; payload: EventUpdatedJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.EVENT_CANCELLED; payload: EventCancelledJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.PASSWORD_RESET; payload: PasswordResetJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.SYNC_STATUSES; payload: SyncStatusesJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.ATTENDANCE_REMINDER; payload: AttendanceReminderJobData } & Traced)
