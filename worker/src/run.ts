import 'dotenv/config'
// Before anything else can fail.
import './runtime/sentry'

import { APP_TIME_ZONE } from '@/lib/date'
import { logger } from '@/lib/logger'
import { JOB_NAMES } from '@/lib/queue/contracts'
import { emailRatePerSecond, smsRatePerSecond } from '@/lib/queue/options'
import { getQueue } from '@/lib/queue/queues'
import { retentionMode } from '@/lib/retention/policy'

import type { QueueJobEnvelope } from '@/lib/queue/contracts'

import { awaitMigrations } from './runtime/await-migrations'
import { warnIfArrayPrototypeIsPolluted } from './runtime/prototype-safety'
import { startHealthReporting } from './runtime/health'
import { parseWorkerQueues, QUEUE_NAME_OF, type WorkerQueueKey } from './runtime/queue-selection'
import { WORKER_SCHEDULES } from './runtime/schedules'
import { registerShutdown } from './runtime/shutdown'
import { spawnQueueWorker, type QueueWorker, type SpawnQueueWorkerOptions } from './runtime/spawn-worker'

// Which queues this process consumes (WORKER_QUEUES, default all) — parsed first, so a typo stops the
// boot instead of leaving a queue nobody reads.
const selected = parseWorkerQueues(process.env.WORKER_QUEUES)

logger.info('Worker starting', { event: 'worker.starting', queues: selected })
warnIfArrayPrototypeIsPolluted('lonvita-worker')

// Filled once the database is migrated. The health endpoint and the shutdown handler come first, so
// a deploy passes Railway's healthcheck (an empty list counts as running) while the worker waits,
// and a SIGTERM then exits cleanly.
const workers: QueueWorker[] = []
const health = startHealthReporting(
  workers,
  selected.map((key) => QUEUE_NAME_OF[key]),
)
registerShutdown('Worker', workers, { beforeClose: health.stop })

await awaitMigrations()

// The schedules add their jobs to the main queue — registered by whoever consumes it. Idempotent by
// scheduler id, so any number of replicas update the one schedule instead of stacking duplicates.
if (selected.includes('main')) {
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
}

/** Concurrency is per process (per replica); the limiters are per queue, across every replica. */
const WORKER_OPTIONS: Record<WorkerQueueKey, () => Omit<SpawnQueueWorkerOptions, 'queueName'>> = {
  main: () => ({}),
  // Few at once: an import holds an AI call for up to minutes and an export renders a PDF on the
  // event loop. WORKER_HEAVY_CONCURRENCY sets another.
  heavy: () => ({ concurrency: Number(process.env.WORKER_HEAVY_CONCURRENCY) || 2 }),
  // Each provider at the rate it takes; a few in flight are enough to keep up with that.
  email: () => ({
    concurrency: emailRatePerSecond() * 2,
    limiter: { max: emailRatePerSecond(), duration: 1_000 },
  }),
  sms: () => ({
    concurrency: smsRatePerSecond() * 2,
    limiter: { max: smsRatePerSecond(), duration: 1_000 },
  }),
}

workers.push(...selected.map((key) => spawnQueueWorker({ queueName: QUEUE_NAME_OF[key], ...WORKER_OPTIONS[key]() })))
// BullMQ starts its workers on the next tick — the first heartbeat once they run, not 30 s later.
setTimeout(() => void health.beat(), 1_000).unref()
