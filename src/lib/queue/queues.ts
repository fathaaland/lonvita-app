import { Queue } from 'bullmq'

import { JOB_NAMES, QUEUE_NAME } from './contracts'
import { queueOptions } from './options'

import type { EmailJobData, JobName, NotificationJobData, QueueJobEnvelope, SmsJobData } from './contracts'

let queueInstance: Queue<QueueJobEnvelope, unknown, JobName> | undefined

export const getQueue = (): Queue<QueueJobEnvelope, unknown, JobName> => {
  if (!queueInstance) {
    queueInstance = new Queue<QueueJobEnvelope, unknown, JobName>(QUEUE_NAME, queueOptions)
  }
  return queueInstance
}

type EnqueueOptions = { jobId?: string; delay?: number }

const enqueueJob = (job: QueueJobEnvelope, options?: EnqueueOptions) => {
  return getQueue().add(job.jobType, job, {
    ...(options?.jobId ? { jobId: options.jobId } : {}),
    ...(options?.delay ? { delay: options.delay } : {}),
  })
}

export async function enqueueEmail(data: EmailJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.SEND_EMAIL, payload: data }, options)
}

export async function enqueueNotification(data: NotificationJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.PUSH_NOTIFICATION, payload: data }, options)
}

export async function enqueueSms(data: SmsJobData, options?: EnqueueOptions) {
  return enqueueJob({ jobType: JOB_NAMES.SEND_SMS, payload: data }, options)
}
