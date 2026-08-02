import { Queue } from 'bullmq'

import { JOB_NAMES, QUEUE_NAME } from './contracts'
import { queueOptions } from './options'

import type { EmailJobData, JobName, NotificationJobData, QueueJobEnvelope } from './contracts'

let queueInstance: Queue<QueueJobEnvelope, unknown, JobName> | undefined

export const getQueue = (): Queue<QueueJobEnvelope, unknown, JobName> => {
  if (!queueInstance) {
    queueInstance = new Queue<QueueJobEnvelope, unknown, JobName>(QUEUE_NAME, queueOptions)
  }
  return queueInstance
}

const enqueueJob = (job: QueueJobEnvelope, jobId?: string) => {
  return getQueue().add(job.jobType, job, jobId ? { jobId } : {})
}

export async function enqueueEmail(data: EmailJobData) {
  return enqueueJob({ jobType: JOB_NAMES.SEND_EMAIL, payload: data })
}

export async function enqueueNotification(data: NotificationJobData) {
  return enqueueJob({ jobType: JOB_NAMES.PUSH_NOTIFICATION, payload: data })
}
