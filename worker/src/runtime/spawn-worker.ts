import { Worker } from 'bullmq'

import { logger, serializeError } from '@/lib/logger'
import { runWithCorrelationId } from '@/lib/logger/correlation'
import { workerOptions } from '@/lib/queue/options'
import { queueConnectionOptions } from '@/lib/valkey/client'

import { APP_TIME_ZONE } from '@/lib/date'

import { dispatchJobByType } from './job-dispatcher'
import { ProviderRateLimitedError } from './provider-errors'
import { scheduleOf } from './schedules'
import { Sentry } from './sentry'

import type { JobName, QueueJobEnvelope } from '@/lib/queue/contracts'

const getConcurrency = (): number => {
  const envValue = process.env.WORKER_QUEUE_CONCURRENCY
  const parsed = Number(envValue)
  if (envValue && Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }
  return 5
}

export type QueueWorker = { name: string; close: () => Promise<void>; isRunning: () => boolean }

export type SpawnQueueWorkerOptions = {
  queueName: string
  /** Jobs in flight at once in this process; WORKER_QUEUE_CONCURRENCY (default 5) when unset. */
  concurrency?: number
  /** At most `max` jobs per `duration` ms across every replica — the provider's own rate limit. */
  limiter?: { max: number; duration: number }
}

export const spawnQueueWorker = ({ queueName, concurrency = getConcurrency(), limiter }: SpawnQueueWorkerOptions): QueueWorker => {
  const worker: Worker<QueueJobEnvelope, unknown, JobName> = new Worker<QueueJobEnvelope, unknown, JobName>(
    queueName,
    async (job) => {
      // Re-enter the trace the web request started: everything the processors log from here
      // on carries the same correlationId as the HTTP request that enqueued the job, so a
      // failed e-mail on Railway lines up with the click on Vercel that asked for it.
      const run = () =>
        runWithCorrelationId(job.data.correlationId ?? 'no-correlation-id', () =>
          dispatchJobByType(job.data, {
            jobId: job.id,
            attemptsMade: job.attemptsMade,
            attempts: job.opts.attempts,
          }),
        )
      // A run of a schedule checks in with its Sentry cron monitor — a missed or failed run alerts.
      const schedule = job.repeatJobKey ? scheduleOf(job.data.jobType) : undefined
      try {
        return schedule
          ? await Sentry.withMonitor(`lonvita-worker-${schedule.jobType}`, run, {
              schedule: { type: 'crontab', value: schedule.pattern },
              timezone: APP_TIME_ZONE,
              checkinMargin: schedule.checkinMarginMinutes ?? 30,
              maxRuntime: schedule.maxRuntimeMinutes ?? 60,
            })
          : await run()
      } catch (error) {
        if (error instanceof ProviderRateLimitedError) {
          // The whole queue waits, and this job goes back without using up a try.
          await worker.rateLimit(error.retryAfterMs)
          throw Worker.RateLimitError()
        }
        throw error
      }
    },
    {
      connection: queueConnectionOptions,
      concurrency,
      ...(limiter ? { limiter } : {}),
      ...workerOptions,
    },
  )

  worker.on('completed', (job, result) => {
    logger.info('Queue job completed', {
      event: 'queue.job_completed',
      jobId: job.id,
      jobType: job.data.jobType,
      correlationId: job.data.correlationId,
      result,
    })
  })

  worker.on('failed', (job, err) => {
    const exhausted = job ? job.attemptsMade >= (job.opts?.attempts ?? 1) : undefined
    // Sentry hears of a job only once it's lost for good (a retry may still make it); no job data —
    // it carries addresses and texts.
    if (exhausted !== false) {
      Sentry.captureException(err, {
        tags: { queue: queueName, jobType: job?.data.jobType ?? 'unknown' },
        extra: { jobId: job?.id, attemptsMade: job?.attemptsMade, correlationId: job?.data.correlationId },
        fingerprint: ['queue-job-exhausted', queueName, job?.data.jobType ?? 'unknown'],
      })
    }
    logger.error('Queue job failed', {
      event: 'queue.job_failed',
      jobId: job?.id,
      jobType: job?.data.jobType,
      attemptsMade: job?.attemptsMade,
      // A job that has used up its attempts is gone for good unless somebody replays it — the
      // distinction decides whether this line needs acting on.
      exhausted,
      correlationId: job?.data.correlationId,
      ...serializeError(err),
    })
  })

  worker.on('stalled', (jobId) => {
    logger.warn('Queue job stalled', { event: 'queue.job_stalled', jobId })
  })

  worker.on('error', (err) => {
    Sentry.captureException(err, { tags: { queue: queueName }, fingerprint: ['queue-worker-error', queueName] })
    logger.error('Queue worker error', { event: 'queue.worker_error', ...serializeError(err) })
  })

  logger.info('Queue worker started', {
    event: 'queue.worker_started',
    queue: queueName,
    concurrency,
    limiter: limiter ?? null,
    ...workerOptions,
  })

  return {
    name: worker.name,
    close: () => worker.close(),
    isRunning: () => worker.isRunning(),
  }
}
