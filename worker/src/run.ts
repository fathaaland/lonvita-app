import 'dotenv/config'

import { logger } from '@/lib/logger'
import { JOB_NAMES } from '@/lib/queue/contracts'
import { getQueue } from '@/lib/queue/queues'

import { warnIfArrayPrototypeIsPolluted } from './runtime/prototype-safety'
import { registerShutdown } from './runtime/shutdown'
import { spawnQueueWorker } from './runtime/spawn-worker'

/** Nightly, at an hour when nobody is looking at their notifications. Retention is measured in
 * days, so the exact minute doesn't matter — only that it runs once a day and not during the
 * evening when people actually use the app. Prague time, not the container's UTC. */
const CLEANUP_NOTIFICATIONS_CRON = '0 3 * * *'
const CLEANUP_NOTIFICATIONS_TZ = 'Europe/Prague'

logger.info('Worker starting', { event: 'worker.starting' })
warnIfArrayPrototypeIsPolluted('lonvita-worker')

// Idempotent by scheduler id: restarting the worker (or running several of them) updates the one
// schedule instead of stacking up duplicates, and changing the cron here takes effect on boot.
await getQueue().upsertJobScheduler(
  JOB_NAMES.CLEANUP_NOTIFICATIONS,
  { pattern: CLEANUP_NOTIFICATIONS_CRON, tz: CLEANUP_NOTIFICATIONS_TZ },
  {
    name: JOB_NAMES.CLEANUP_NOTIFICATIONS,
    data: { jobType: JOB_NAMES.CLEANUP_NOTIFICATIONS, payload: {} },
  },
)
logger.info('Notification cleanup schedule registered', {
  event: 'worker.cleanup_schedule_registered',
  pattern: CLEANUP_NOTIFICATIONS_CRON,
  tz: CLEANUP_NOTIFICATIONS_TZ,
})

const worker = spawnQueueWorker()

registerShutdown('Worker', [worker])
