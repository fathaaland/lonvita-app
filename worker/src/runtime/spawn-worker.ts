import { Worker } from 'bullmq'

import { logger } from '@/lib/logger'
import { QUEUE_NAME } from '@/lib/queue/contracts'
import { queueConnectionOptions } from '@/lib/valkey/client'

import { dispatchJobByType } from './job-dispatcher'

import type { JobName, QueueJobEnvelope } from '@/lib/queue/contracts'

const getConcurrency = (): number => {
  const envValue = process.env.WORKER_QUEUE_CONCURRENCY
  const parsed = Number(envValue)
  if (envValue && Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }
  return 5
}

export type QueueWorker = { name: string; close: () => Promise<void> }

export const spawnQueueWorker = (): QueueWorker => {
  const concurrency = getConcurrency()

  const worker = new Worker<QueueJobEnvelope, unknown, JobName>(
    QUEUE_NAME,
    async (job) => {
      return dispatchJobByType(job.data, {
        jobId: job.id,
        attemptsMade: job.attemptsMade,
      })
    },
    {
      connection: queueConnectionOptions,
      concurrency,
    },
  )

  worker.on('completed', (job, result) => {
    logger.info('[Worker] Job completed', {
      jobId: job.id,
      jobType: job.data.jobType,
      result,
    })
  })

  worker.on('failed', (job, err) => {
    logger.error('[Worker] Job failed', {
      jobId: job?.id,
      jobType: job?.data.jobType,
      attemptsMade: job?.attemptsMade,
      error: err?.message ?? String(err),
      stack: err?.stack,
    })
  })

  worker.on('stalled', (jobId) => {
    logger.warn('[Worker] Job stalled - will be retried', { jobId })
  })

  worker.on('error', (err) => {
    logger.error('[Worker] Worker-level error', { error: err.message })
  })

  logger.info('[Worker] Queue worker started', { queue: QUEUE_NAME, concurrency })

  return {
    name: worker.name,
    close: () => worker.close(),
  }
}
