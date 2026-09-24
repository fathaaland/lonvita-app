import { Queue } from 'bullmq'

import { getCorrelationId } from '@/lib/logger/correlation'

import { JOB_NAMES, QUEUE_NAME } from './contracts'
import { queueOptions } from './options'

import type { EmailJobData, FeedbackRequestJobData, JobName, QueueJobEnvelope, SmsJobData } from './contracts'

let queueInstance: Queue<QueueJobEnvelope, unknown, JobName> | undefined

export const getQueue = (): Queue<QueueJobEnvelope, unknown, JobName> => {
  if (!queueInstance) {
    queueInstance = new Queue<QueueJobEnvelope, unknown, JobName>(QUEUE_NAME, queueOptions)
  }
  return queueInstance
}

type EnqueueOptions = { jobId?: string; delay?: number; correlationId?: string }

const enqueueJob = (job: QueueJobEnvelope, options?: EnqueueOptions) => {
  const traced = { ...job, correlationId: options?.correlationId ?? getCorrelationId() }

  return getQueue().add(job.jobType, traced, {
    ...(options?.jobId ? { jobId: options.jobId } : {}),
    ...(options?.delay ? { delay: options.delay } : {}),
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
