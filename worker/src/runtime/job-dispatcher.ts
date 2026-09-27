import { JOB_NAMES } from '@/lib/queue/contracts'

import { processCleanupExportsJob } from '../processors/cleanup-exports.processor'
import { processCleanupNotificationsJob } from '../processors/cleanup-notifications.processor'
import { processEmailJob } from '../processors/email.processor'
import { processEventCancelledJob } from '../processors/event-cancelled.processor'
import { processEventUpdatedJob } from '../processors/event-updated.processor'
import { processExportReadyJob } from '../processors/export-ready.processor'
import { processFeedbackRequestJob } from '../processors/feedback-request.processor'
import { processGenerateExportJob } from '../processors/generate-export.processor'
import { processSmsJob } from '../processors/sms.processor'

import type {
  CleanupExportsJobResult,
  CleanupNotificationsJobResult,
  EmailJobResult,
  EventCancelledJobResult,
  EventUpdatedJobResult,
  ExportReadyJobResult,
  FeedbackRequestJobResult,
  GenerateExportJobResult,
  QueueJobEnvelope,
} from '@/lib/queue/contracts'

type DispatchContext = {
  jobId?: string
  attemptsMade?: number
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

    default:
      throw new Error(`Unsupported job type: ${(job as QueueJobEnvelope).jobType}`)
  }
}
