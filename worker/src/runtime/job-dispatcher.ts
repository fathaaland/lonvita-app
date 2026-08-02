import { JOB_NAMES } from '@/lib/queue/contracts'

import { processEmailJob } from '../processors/email.processor'
import { processNotificationJob } from '../processors/notification.processor'

import type { EmailJobResult, QueueJobEnvelope } from '@/lib/queue/contracts'

type DispatchContext = {
  jobId?: string
  attemptsMade?: number
}

type JobResult = EmailJobResult | void

export const dispatchJobByType = async (
  job: QueueJobEnvelope,
  context: DispatchContext,
): Promise<JobResult> => {
  switch (job.jobType) {
    case JOB_NAMES.SEND_EMAIL:
      return processEmailJob(job.payload, context)

    case JOB_NAMES.PUSH_NOTIFICATION:
      return processNotificationJob(job.payload, context)

    default:
      throw new Error(`Unsupported job type: ${(job as QueueJobEnvelope).jobType}`)
  }
}
