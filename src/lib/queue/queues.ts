import { Queue } from 'bullmq'

import { getCorrelationId } from '@/lib/logger/correlation'

import { JOB_NAMES, QUEUE_NAME } from './contracts'
import { queueOptions } from './options'

import type { DeduplicationOptions } from 'bullmq'
import type {
  EmailJobData,
  EventCancelledJobData,
  EventUpdatedJobData,
  ExportReadyJobData,
  FeedbackRequestJobData,
  GenerateExportJobData,
  JobName,
  PasswordResetJobData,
  QueueJobEnvelope,
  SmsJobData,
} from './contracts'

let queueInstance: Queue<QueueJobEnvelope, unknown, JobName> | undefined

export const getQueue = (): Queue<QueueJobEnvelope, unknown, JobName> => {
  if (!queueInstance) {
    queueInstance = new Queue<QueueJobEnvelope, unknown, JobName>(QUEUE_NAME, queueOptions)
  }
  return queueInstance
}

type EnqueueOptions = {
  jobId?: string
  delay?: number
  correlationId?: string
  deduplication?: DeduplicationOptions
}

const enqueueJob = (job: QueueJobEnvelope, options?: EnqueueOptions) => {
  const traced = { ...job, correlationId: options?.correlationId ?? getCorrelationId() }

  return getQueue().add(job.jobType, traced, {
    ...(options?.jobId ? { jobId: options.jobId } : {}),
    ...(options?.delay ? { delay: options.delay } : {}),
    ...(options?.deduplication ? { deduplication: options.deduplication } : {}),
  })
}

export async function enqueueEmail(data: EmailJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.SEND_EMAIL, payload: data }, options)
}

export async function enqueueSms(data: SmsJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.SEND_SMS, payload: data }, options)
}

export async function enqueueFeedbackRequest(data: FeedbackRequestJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.FEEDBACK_REQUEST, payload: data }, options)
}

export async function enqueueGenerateExport(data: GenerateExportJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.GENERATE_EXPORT, payload: data }, options)
}

export async function enqueueExportReady(data: ExportReadyJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.EXPORT_READY, payload: data }, options)
}

/** Edits within this window after the first one ride along in its job instead of adding their own. */
export const EVENT_UPDATED_DEBOUNCE_MS = 60_000
/** Past the debounce window, so the last edit it swallowed has long committed when the job reads. */
const EVENT_UPDATED_DELAY_MS = EVENT_UPDATED_DEBOUNCE_MS + 5_000

/**
 * Debounced per event: while the first edit's job is inside its window, later adds are dropped —
 * data included — so the job keeps the pre-burst baseline and notifies once about all of it.
 */
export async function enqueueEventUpdated(data: EventUpdatedJobData, options?: EnqueueOptions) {
  return enqueueJob(
    { jobType: JOB_NAMES.EVENT_UPDATED, payload: data },
    {
      delay: EVENT_UPDATED_DELAY_MS,
      deduplication: { id: `event-updated-${data.eventId}`, ttl: EVENT_UPDATED_DEBOUNCE_MS },
      ...options,
    },
  )
}

export async function enqueueEventCancelled(data: EventCancelledJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.EVENT_CANCELLED, payload: data }, options)
}

export async function enqueuePasswordReset(data: PasswordResetJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.PASSWORD_RESET, payload: data }, options)
}
