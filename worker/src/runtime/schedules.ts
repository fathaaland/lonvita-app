import { JOB_NAMES } from '@/lib/queue/contracts'

import type { JobName } from '@/lib/queue/contracts'

export type WorkerSchedule = {
  jobType: JobName
  /** Cron, in APP_TIME_ZONE (Prague), not the container's UTC. */
  pattern: string
  /** The `event` of the log line that says it's registered. */
  logEvent: string
  logMessage: string
  /** Gone from Redis as soon as it's done — for a job that runs so often it would push the jobs whose
   * ids must stay remembered (a cancellation's) out of the main queue's last 500. */
  forgetWhenDone?: boolean
  /** Minutes a run may be late before Sentry calls it missed (its cron monitor). */
  checkinMarginMinutes?: number
  /** Minutes a run may take before Sentry calls it timed out. */
  maxRuntimeMinutes?: number
}

/**
 * Everything the worker runs on the clock. Registered on boot (run.ts) by scheduler id — idempotent:
 * restarting the worker (or running several of them) updates the one schedule instead of stacking up
 * duplicates, and changing a cron here takes effect on boot. Each one also reports to its Sentry cron
 * monitor (runtime/spawn-worker), so a worker that stopped running them — asleep, crashed, cut off from
 * Redis — is an alert, not something found out days later.
 */
export const WORKER_SCHEDULES: WorkerSchedule[] = [
  {
    // Retention is measured in days, so the exact minute doesn't matter — only that it runs once a
    // day and not during the evening when people actually use the app.
    jobType: JOB_NAMES.CLEANUP_NOTIFICATIONS,
    pattern: '0 3 * * *',
    logEvent: 'worker.cleanup_schedule_registered',
    logMessage: 'Notification cleanup schedule registered',
  },
  {
    // Expired exports (7 days) — half an hour after the notification cleanup, same quiet window.
    jobType: JOB_NAMES.CLEANUP_EXPORTS,
    pattern: '30 3 * * *',
    logEvent: 'worker.cleanup_schedule_registered',
    logMessage: 'Export cleanup schedule registered',
  },
  {
    // Time-driven statuses (finished events, expired deletion requests). Often, not nightly: the
    // stored status is what filters and counts see, and each run only touches what just lapsed.
    jobType: JOB_NAMES.SYNC_STATUSES,
    pattern: '*/15 * * * *',
    logEvent: 'worker.status_sync_schedule_registered',
    logMessage: 'Status sync schedule registered',
    checkinMarginMinutes: 5,
    maxRuntimeMinutes: 10,
  },
  {
    // Data retention (lib/retention/policy.ts) — after the two cleanups, still in the quiet window.
    // Deletes only with DATA_RETENTION_MODE=enforce; until then each night just reports what's due.
    jobType: JOB_NAMES.DATA_RETENTION,
    pattern: '0 4 * * *',
    logEvent: 'worker.cleanup_schedule_registered',
    logMessage: 'Data retention schedule registered',
  },
  {
    // Event sources (EventSources) — every hour; scan-event-sources reads the sources of the obce
    // whose weekly slot (Municipalities.scrapingSlotDay/Hour) is that hour.
    jobType: JOB_NAMES.SCAN_EVENT_SOURCES,
    pattern: '0 * * * *',
    logEvent: 'worker.import_schedule_registered',
    logMessage: 'Event source scan schedule registered',
    checkinMarginMinutes: 10,
  },
  {
    // Each obec's users (lib/billing/active-users) — the 1st of the month, early morning.
    jobType: JOB_NAMES.SNAPSHOT_ACTIVE_USERS,
    pattern: '15 1 1 * *',
    logEvent: 'worker.snapshot_schedule_registered',
    logMessage: 'Active user snapshot schedule registered',
  },
  {
    // The register of law (LegalRequirements) against e-Sbírka, and reviews come due — early
    // morning, so the platform's admins find any change when they start the day.
    jobType: JOB_NAMES.COMPLIANCE_CHECK,
    pattern: '30 5 * * *',
    logEvent: 'worker.compliance_schedule_registered',
    logMessage: 'Compliance check schedule registered',
  },
  {
    // Audit trail copy (export-audit-trail) — past midnight UTC in either Prague offset, so the day it
    // writes (UTC) is finished; before data retention, which may remove rows the copy should hold.
    jobType: JOB_NAMES.EXPORT_AUDIT_TRAIL,
    pattern: '30 2 * * *',
    logEvent: 'worker.audit_export_schedule_registered',
    logMessage: 'Audit trail export schedule registered',
  },
  {
    // The outbox (lib/outbox) — what didn't reach the queue after its change committed, every minute,
    // so a Redis blip delays an announcement by a minute or two, not for good.
    jobType: JOB_NAMES.OUTBOX_RELAY,
    pattern: '* * * * *',
    logEvent: 'worker.outbox_relay_schedule_registered',
    logMessage: 'Outbox relay schedule registered',
    forgetWhenDone: true,
    checkinMarginMinutes: 5,
    maxRuntimeMinutes: 5,
  },
  {
    // The reminders of the coming days, put back if Redis lost them (restore-reminders) — every hour,
    // so a lost 24h reminder still goes out on time, give or take an hour.
    jobType: JOB_NAMES.RESTORE_REMINDERS,
    pattern: '20 * * * *',
    logEvent: 'worker.restore_reminders_schedule_registered',
    logMessage: 'Reminder restore schedule registered',
    checkinMarginMinutes: 10,
    maxRuntimeMinutes: 30,
  },
]

export const scheduleOf = (jobType: string): WorkerSchedule | undefined =>
  WORKER_SCHEDULES.find((schedule) => schedule.jobType === jobType)
