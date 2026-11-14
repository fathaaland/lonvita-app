import type { ImportInput } from '@/lib/import/contracts'

export const QUEUE_NAME = 'lonvita' as const
/** E-mails and SMS each go through a queue of their own: rate-limited to what the provider takes, and
 * never stuck behind an import or an export rendering in the main queue. */
export const EMAIL_QUEUE_NAME = 'lonvita-email' as const
export const SMS_QUEUE_NAME = 'lonvita-sms' as const
/** Imports (AI extraction, minutes per source) and export rendering — slow and bursty (a nightly
 * scan queues a job per source), so they get their own queue and slots. Otherwise a batch of them
 * holds every slot of the main queue while a password reset or a cancellation fan-out waits. */
export const HEAVY_QUEUE_NAME = 'lonvita-heavy' as const

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
  DATA_RETENTION: 'data-retention',
  SCAN_EVENT_SOURCES: 'scan-event-sources',
  IMPORT_EVENTS: 'import-events',
  EXPORT_AUDIT_TRAIL: 'export-audit-trail',
  REMINDER_SMS: 'reminder-sms',
  SNAPSHOT_ACTIVE_USERS: 'snapshot-active-users',
  COMPLIANCE_CHECK: 'compliance-check',
  OUTBOX_RELAY: 'outbox-relay',
  RESTORE_REMINDERS: 'restore-reminders',
  REGISTRATION_DIGEST: 'registration-digest',
  BILLING_STATUS: 'billing-status',
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
 * Brief §8 "Webová aplikace, tudíž oznámení o změně/zrušení musí jít přes SMS/mail" — sent via
 * BulkGate (worker sms.processor). `requestId` makes the queue job id, so the same announcement
 * isn't enqueued twice for one person. Sent on a cancel, a change of time or place and the reminder a
 * day before, for an event of fewer than SMS_LARGE_EVENT_CAPACITY places (collections/shared/notify).
 */
export type SmsJobData = {
  to: string
  message: string
  requestId?: string
  /** The obec whose SMS it is — counted against its yearly SMS quota (SmsMessages). Optional: jobs
   * queued before it existed carry none. */
  municipalityId?: number
  /** Only on jobs queued before 12. 11. 2026 (past the quota when queued; held no reservation). The
   * ledger decides what's overage now (lib/billing/sms-ledger). */
  overage?: boolean
}

/**
 * Notifications pile up forever otherwise — nothing in the app ever deletes one (Notifications'
 * own access.delete is closed). Enqueued only by the worker's own scheduler, on a daily cron.
 */
/**
 * The day-before reminder by SMS, for a participant who chose SMS (Profiles.notifySms) — delayed to
 * fire 24 h before the event, with a fixed job id per registration (collections/shared/reminders).
 * Everything is checked again when it fires: still approved, the event still on and small enough.
 */
/** The day-before SMS reminder, discontinued 12. 11. 2026 (SMS go out only on a cancellation). Only
 * jobs delayed before then still arrive — the worker drops them unsent. */
export type ReminderSmsJobData = { registrationId: number | string }
export type ReminderSmsJobResult = { sent: number; skipped?: string }

/** The nightly check of the register of law (LegalRequirements): reviews that came due, and new or
 * upcoming versions of the watched regulations in e-Sbírka (lib/compliance/esbirka). */
export type ComplianceCheckJobData = Record<string, never>
export type ComplianceCheckJobResult = {
  checked: number
  changed: string[]
  dueForReview: string[]
  failed: string[]
}

/** The daily step of unpaid and ended obce (lib/billing/status): warnings, read-only, termination, erasure. */
export type BillingStatusJobData = Record<string, never>
export type BillingStatusJobResult = {
  warned: number
  madeReadOnly: number
  terminated: number
  erased: number
  /** Terminated obce past their period that the platform hasn't confirmed for erasure. */
  awaitingConfirmation: number
  eventsCancelled: number
  clockStarted: number
  /** Licence reminders sent (expiring soon / expired). */
  licenceReminded: number
  /** Active obce suspended because their licence ran out and wasn't renewed. */
  licenceSuspended: number
  failed: number
}

/** The monthly snapshot of every obec's users (lib/billing/active-users) — on the worker's cron. */
export type SnapshotActiveUsersJobData = Record<string, never>
export type SnapshotActiveUsersJobResult = { snapshots: number; failed: number }

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
 * Tells an event's registrants it was edited — in-app and by e-mail. Enqueued from Events'
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
  /** Whose SMS service texts the registrants. Optional: jobs queued before it existed carry none. */
  municipalityId?: number
  /** The event's capacity — SMS go out only below SMS_LARGE_EVENT_CAPACITY places (lib/capacity). Optional:
   * jobs queued before it existed carry none (then the event row, if still there, says). */
  capacity?: number
  /** The pořadatel — told when the obec's SMS quota left some registrants without one. Optional:
   * jobs queued before it existed carry none (then the event row, if still there, says). */
  organizerId?: number | string
  /** Pending/approved registrants to tell (the organizer excluded) — approved first, then by when
   * they signed up: the order SMS go out in when the quota runs short. */
  userIds: (number | string)[]
  /** Every registration of the event, whose reminder jobs have to go. */
  registrationIds: (number | string)[]
  /** Volunteers whose invitation or offer for the event was still waiting — they hear it's off too.
   * Optional: jobs queued before it existed carry none. */
  volunteerUserIds?: (number | string)[]
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
 * past their end become 'finished', deletion requests past their 24 h 'expired', volunteer
 * invitations still waiting when their event starts 'withdrawn'. Reads already derive the first
 * two (the collections' afterRead hooks); this makes the stored value, which filters, counts and
 * the admin see, catch up. Enqueued only by the worker's own scheduler.
 */
export type SyncStatusesJobData = Record<string, never>

export type SyncStatusesJobResult = {
  eventsFinished: number
  deletionRequestsExpired: number
  coOrganizingInvitationsExpired: number
  /** Pending volunteer invitations/offers whose event has started — nobody can accept them now. */
  volunteerInvitationsWithdrawn: number
  /** Cancelled events whose announcement never reached the queue, queued again. */
  cancellationNoticesCaughtUp: number
}

/**
 * Nightly: removes what no overview reads any more, by the periods in lib/retention/policy.ts —
 * decided requests and invitations, cancelled events, stale registrations, orphaned uploads, audit
 * entries past their retention. Every removal is written to the audit log in the same transaction.
 * `DATA_RETENTION_MODE=enforce` deletes; otherwise the run only counts. Enqueued only by the
 * worker's own scheduler.
 */
export type DataRetentionJobData = Record<string, never>

export type DataRetentionStepResult = {
  /** Rows the rule matched (all of them in a dry run; up to the per-run cap). */
  matched: number
  deleted: number
}

export type DataRetentionJobResult = {
  mode: 'enforce' | 'dry-run'
  steps: Record<string, DataRetentionStepResult>
  /** Steps that threw — the others ran regardless. */
  failed: string[]
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
 * Each midnight: queues an IMPORT_EVENTS job for each enabled event source (EventSources) — the
 * nightly check, or the night to Monday the full pass (`trigger` forces one). Enqueued only by the
 * worker's own scheduler.
 */
/** Empty — which obce are due is worked out from their slots (scan-event-sources). */
export type ScanEventSourcesJobData = { trigger?: 'daily' | 'weekly' }

export type ScanEventSourcesJobResult = {
  queued: number
}

/**
 * Reads events out of one input — a saved source, a pasted program, an uploaded file — into
 * EventImportCandidates for the obec's admin to approve (lib/import/pipeline). Carries only what
 * to read; the file itself waits in S3 (lib/import/storage).
 */
export type ImportEventsJobData = ImportInput

export type ImportEventsJobResult = {
  found: number
  created: number
  updated: number
  skipped?: string
}

/**
 * Nightly: each finished day of the audit log and the security events goes, as one JSON Lines file,
 * to the write-once audit bucket (AUDIT_EXPORT_BUCKET, S3 Object Lock) — the copy outside the app
 * that vyhláška č. 409/2025 Sb. § 22 odst. 5 asks for. Days already there are skipped, so a missed
 * night is caught up. Enqueued only by the worker's own scheduler.
 */
export type ExportAuditTrailJobData = Record<string, never>

export type ExportAuditTrailJobResult = {
  /** Days written this run (YYYY-MM-DD, UTC). */
  exported: string[]
  /** Days that failed — tried again the next night. */
  failed: string[]
  /** not_configured: no bucket. lock_not_enforced: the bucket let the run delete (or didn't lock) its
   * probe file; probe_failed: the bucket couldn't be checked (S3 down) — nothing exported either way,
   * so data retention keeps the rows too. */
  skipped?: 'not_configured' | 'lock_not_enforced' | 'probe_failed'
}

/**
 * Every minute: hands the outbox's jobs (lib/outbox) that still aren't in the queue a minute after
 * they were written to it again, under their own job ids; drops what was dispatched a week ago; and
 * says (log, Sentry) when announcements are stuck or e-mails pile up. Enqueued only by the worker's
 * own scheduler.
 */
export type OutboxRelayJobData = Record<string, never>

export type OutboxRelayJobResult = {
  relayed: number
  failed: number
  /** Rows dispatched long ago (or given up on) deleted this run. */
  purged: number
  /** Not in the queue OUTBOX_STUCK_AFTER_MS after they were written — the alert. */
  stuck: number
  emailsWaiting: number | null
}

/**
 * Every hour: puts back the reminders of the coming days that Redis lost (collections/shared/reminders
 * restoreMissingReminders) — only those still ahead. Enqueued only by the worker's own scheduler.
 */
export type RestoreRemindersJobData = Record<string, never>
export type RestoreRemindersJobResult = { events: number; restored: number; failed: number }

/**
 * The e-mail to an event's team about the registrations of one window (lib/notifications/
 * registration-digest) — one per recipient instead of one per registration. Queued by the
 * registrations' hook, delayed until the window has closed.
 */
export type RegistrationDigestJobData = { eventId: number | string; windowStart: number }
export type RegistrationDigestJobResult = { recipients: number; registrations: number; emails: number }

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
  | ({
      jobType: typeof JOB_NAMES.CLEANUP_NOTIFICATIONS
      payload: CleanupNotificationsJobData
    } & Traced)
  | ({ jobType: typeof JOB_NAMES.FEEDBACK_REQUEST; payload: FeedbackRequestJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.GENERATE_EXPORT; payload: GenerateExportJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.EXPORT_READY; payload: ExportReadyJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.CLEANUP_EXPORTS; payload: CleanupExportsJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.EVENT_UPDATED; payload: EventUpdatedJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.EVENT_CANCELLED; payload: EventCancelledJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.PASSWORD_RESET; payload: PasswordResetJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.SYNC_STATUSES; payload: SyncStatusesJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.ATTENDANCE_REMINDER; payload: AttendanceReminderJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.DATA_RETENTION; payload: DataRetentionJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.SCAN_EVENT_SOURCES; payload: ScanEventSourcesJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.IMPORT_EVENTS; payload: ImportEventsJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.EXPORT_AUDIT_TRAIL; payload: ExportAuditTrailJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.REMINDER_SMS; payload: ReminderSmsJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.SNAPSHOT_ACTIVE_USERS; payload: SnapshotActiveUsersJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.BILLING_STATUS; payload: BillingStatusJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.COMPLIANCE_CHECK; payload: ComplianceCheckJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.OUTBOX_RELAY; payload: OutboxRelayJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.RESTORE_REMINDERS; payload: RestoreRemindersJobData } & Traced)
  | ({ jobType: typeof JOB_NAMES.REGISTRATION_DIGEST; payload: RegistrationDigestJobData } & Traced)
