import { JOB_NAMES } from '@/lib/queue/contracts'

import { processCleanupNotificationsJob } from '../processors/cleanup-notifications.processor'
import { processEmailJob } from '../processors/email.processor'
import { processFeedbackRequestJob } from '../processors/feedback-request.processor'
import { processSmsJob } from '../processors/sms.processor'

import type {
  CleanupNotificationsJobResult,
  EmailJobResult,
  FeedbackRequestJobResult,
  QueueJobEnvelope,
} from '@/lib/queue/contracts'

type DispatchContext = {
  jobId?: string
  attemptsMade?: number
}

type JobResult = EmailJobResult | CleanupNotificationsJobResult | FeedbackRequestJobResult | void

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

    default:
      throw new Error(`Unsupported job type: ${(job as QueueJobEnvelope).jobType}`)
  }
}
