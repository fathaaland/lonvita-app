import 'dotenv/config'
// Before anything else can fail.
import './runtime/sentry'

import { APP_TIME_ZONE } from '@/lib/date'
import { logger } from '@/lib/logger'
import { EMAIL_QUEUE_NAME, HEAVY_QUEUE_NAME, JOB_NAMES, QUEUE_NAME, SMS_QUEUE_NAME } from '@/lib/queue/contracts'
import { emailRatePerSecond, smsRatePerSecond } from '@/lib/queue/options'
import { getQueue } from '@/lib/queue/queues'
import { retentionMode } from '@/lib/retention/policy'

import type { QueueJobEnvelope } from '@/lib/queue/contracts'

import { warnIfArrayPrototypeIsPolluted } from './runtime/prototype-safety'
import { startHealthReporting } from './runtime/health'
import { WORKER_SCHEDULES } from './runtime/schedules'
import { registerShutdown } from './runtime/shutdown'
import { spawnQueueWorker } from './runtime/spawn-worker'

logger.info('Worker starting', { event: 'worker.starting' })
warnIfArrayPrototypeIsPolluted('lonvita-worker')

for (const schedule of WORKER_SCHEDULES) {
  await getQueue().upsertJobScheduler(
    schedule.jobType,
    { pattern: schedule.pattern, tz: APP_TIME_ZONE },
    {
      name: schedule.jobType,
      data: { jobType: schedule.jobType, payload: {} } as QueueJobEnvelope,
      ...(schedule.forgetWhenDone ? { opts: { removeOnComplete: true, removeOnFail: { count: 100 } } } : {}),
    },
  )
  logger.info(schedule.logMessage, {
    event: schedule.logEvent,
    pattern: schedule.pattern,
    tz: APP_TIME_ZONE,
    ...(schedule.jobType === JOB_NAMES.DATA_RETENTION ? { mode: retentionMode() } : {}),
    ...(schedule.jobType === JOB_NAMES.EXPORT_AUDIT_TRAIL
      ? { bucket: process.env.AUDIT_EXPORT_BUCKET?.trim() || null }
      : {}),
  })
}

const workers = [
  spawnQueueWorker({ queueName: QUEUE_NAME }),
  // Few at once: an import holds an AI call for up to minutes and an export renders a PDF on the
  // event loop. WORKER_HEAVY_CONCURRENCY sets another.
  spawnQueueWorker({ queueName: HEAVY_QUEUE_NAME, concurrency: Number(process.env.WORKER_HEAVY_CONCURRENCY) || 2 }),
  // Each provider at the rate it takes; a few in flight are enough to keep up with that.
  spawnQueueWorker({
    queueName: EMAIL_QUEUE_NAME,
    concurrency: emailRatePerSecond() * 2,
    limiter: { max: emailRatePerSecond(), duration: 1_000 },
  }),
  spawnQueueWorker({
    queueName: SMS_QUEUE_NAME,
    concurrency: smsRatePerSecond() * 2,
    limiter: { max: smsRatePerSecond(), duration: 1_000 },
  }),
]

const stopHealthReporting = startHealthReporting(workers)

registerShutdown('Worker', workers, { beforeClose: stopHealthReporting })
