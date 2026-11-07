import { JOB_NAMES } from '@/lib/queue/contracts'

import { processAttendanceReminderJob } from '../processors/attendance-reminder.processor'
import { processComplianceCheckJob } from '../processors/compliance-check.processor'
import { processCleanupExportsJob } from '../processors/cleanup-exports.processor'
import { processCleanupNotificationsJob } from '../processors/cleanup-notifications.processor'
import { processDataRetentionJob } from '../processors/data-retention.processor'
import { processEmailJob } from '../processors/email.processor'
import { processEventCancelledJob } from '../processors/event-cancelled.processor'
import { processEventUpdatedJob } from '../processors/event-updated.processor'
import { processExportAuditTrailJob } from '../processors/export-audit-trail.processor'
import { processExportReadyJob } from '../processors/export-ready.processor'
import { processFeedbackRequestJob } from '../processors/feedback-request.processor'
import { processGenerateExportJob } from '../processors/generate-export.processor'
import { processImportEventsJob } from '../processors/import-events.processor'
import { processOutboxRelayJob } from '../processors/outbox-relay.processor'
import { processPasswordResetJob } from '../processors/password-reset.processor'
import { processRegistrationDigestJob } from '../processors/registration-digest.processor'
import { processReminderSmsJob } from '../processors/reminder-sms.processor'
import { processRestoreRemindersJob } from '../processors/restore-reminders.processor'
import { processScanEventSourcesJob } from '../processors/scan-event-sources.processor'
import { processSmsJob } from '../processors/sms.processor'
import { processSnapshotActiveUsersJob } from '../processors/snapshot-active-users.processor'
import { processSyncStatusesJob } from '../processors/sync-statuses.processor'

import type {
  AttendanceReminderJobResult,
  CleanupExportsJobResult,
  CleanupNotificationsJobResult,
  ComplianceCheckJobResult,
  DataRetentionJobResult,
  EmailJobResult,
  EventCancelledJobResult,
  EventUpdatedJobResult,
  ExportAuditTrailJobResult,
  ExportReadyJobResult,
  FeedbackRequestJobResult,
  GenerateExportJobResult,
  ImportEventsJobResult,
  OutboxRelayJobResult,
  PasswordResetJobResult,
  QueueJobEnvelope,
  RegistrationDigestJobResult,
  ReminderSmsJobResult,
  RestoreRemindersJobResult,
  ScanEventSourcesJobResult,
  SnapshotActiveUsersJobResult,
  SyncStatusesJobResult,
} from '@/lib/queue/contracts'

type DispatchContext = {
  jobId?: string
  attemptsMade?: number
  attempts?: number
}

type JobResult =
  | EmailJobResult
  | CleanupNotificationsJobResult
  | FeedbackRequestJobResult
  | GenerateExportJobResult
  | ExportReadyJobResult
  | CleanupExportsJobResult
  | EventUpdatedJobResult
  | EventCancelledJobResult
  | PasswordResetJobResult
  | SyncStatusesJobResult
  | AttendanceReminderJobResult
  | DataRetentionJobResult
  | ScanEventSourcesJobResult
  | ReminderSmsJobResult
  | SnapshotActiveUsersJobResult
  | ComplianceCheckJobResult
  | ImportEventsJobResult
  | ExportAuditTrailJobResult
  | OutboxRelayJobResult
  | RestoreRemindersJobResult
  | RegistrationDigestJobResult
  | void

export const dispatchJobByType = async (
  job: QueueJobEnvelope,
  context: DispatchContext,
): Promise<JobResult> => {
  switch (job.jobType) {
    case JOB_NAMES.SEND_EMAIL:
      return processEmailJob(job.payload, context)

    case JOB_NAMES.SEND_SMS:
      return processSmsJob(job.payload, context)

    case JOB_NAMES.CLEANUP_NOTIFICATIONS:
      return processCleanupNotificationsJob()

    case JOB_NAMES.FEEDBACK_REQUEST:
      return processFeedbackRequestJob(job.payload)

    case JOB_NAMES.GENERATE_EXPORT:
      return processGenerateExportJob(job.payload, context)

    case JOB_NAMES.EXPORT_READY:
      return processExportReadyJob(job.payload)

    case JOB_NAMES.CLEANUP_EXPORTS:
      return processCleanupExportsJob()

    case JOB_NAMES.EVENT_UPDATED:
      return processEventUpdatedJob(job.payload, context)

    case JOB_NAMES.EVENT_CANCELLED:
      return processEventCancelledJob(job.payload, context)

    case JOB_NAMES.PASSWORD_RESET:
      return processPasswordResetJob(job.payload, context)

    case JOB_NAMES.SYNC_STATUSES:
      return processSyncStatusesJob()

    case JOB_NAMES.ATTENDANCE_REMINDER:
      return processAttendanceReminderJob(job.payload, context)

    case JOB_NAMES.DATA_RETENTION:
      return processDataRetentionJob()

    case JOB_NAMES.SCAN_EVENT_SOURCES:
      return processScanEventSourcesJob(job.payload)

    case JOB_NAMES.IMPORT_EVENTS:
      return processImportEventsJob(job.payload, context)

    case JOB_NAMES.REMINDER_SMS:
      return processReminderSmsJob(job.payload)

    case JOB_NAMES.SNAPSHOT_ACTIVE_USERS:
      return processSnapshotActiveUsersJob()

    case JOB_NAMES.COMPLIANCE_CHECK:
      return processComplianceCheckJob()

    case JOB_NAMES.EXPORT_AUDIT_TRAIL:
      return processExportAuditTrailJob()

    case JOB_NAMES.REGISTRATION_DIGEST:
      return processRegistrationDigestJob(job.payload)

    case JOB_NAMES.OUTBOX_RELAY:
      return processOutboxRelayJob()

    case JOB_NAMES.RESTORE_REMINDERS:
      return processRestoreRemindersJob()

    default:
      throw new Error(`Unsupported job type: ${(job as QueueJobEnvelope).jobType}`)
  }
}
