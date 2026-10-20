import 'dotenv/config'

import { APP_TIME_ZONE } from '@/lib/date'
import { SOURCE_SCAN_INTERVAL_HOURS } from '@/lib/import/contracts'
import { logger } from '@/lib/logger'
import { JOB_NAMES } from '@/lib/queue/contracts'
import { getQueue } from '@/lib/queue/queues'
import { retentionMode } from '@/lib/retention/policy'

import { warnIfArrayPrototypeIsPolluted } from './runtime/prototype-safety'
import { registerShutdown } from './runtime/shutdown'
import { spawnQueueWorker } from './runtime/spawn-worker'

/** Nightly, at an hour when nobody is looking at their notifications. Retention is measured in
 * days, so the exact minute doesn't matter — only that it runs once a day and not during the
 * evening when people actually use the app. Prague time, not the container's UTC. */
const CLEANUP_NOTIFICATIONS_CRON = '0 3 * * *'
/** Expired exports (7 days) — half an hour after the notification cleanup, same quiet window. */
const CLEANUP_EXPORTS_CRON = '30 3 * * *'
/** Time-driven statuses (finished events, expired deletion requests). Often, not nightly: the
 * stored status is what filters and counts see, and each run only touches what just lapsed. */
const SYNC_STATUSES_CRON = '*/15 * * * *'
/** Data retention (lib/retention/policy.ts) — after the two cleanups, still in the quiet window.
 * Deletes only with DATA_RETENTION_MODE=enforce; until then each night just reports what's due. */
const DATA_RETENTION_CRON = '0 4 * * *'
/** Event sources (EventSources) — every SOURCE_SCAN_INTERVAL_HOURS, off the full hour. */
const SCAN_EVENT_SOURCES_CRON = `20 */${SOURCE_SCAN_INTERVAL_HOURS} * * *`

logger.info('Worker starting', { event: 'worker.starting' })
warnIfArrayPrototypeIsPolluted('lonvita-worker')

// Idempotent by scheduler id: restarting the worker (or running several of them) updates the one
// schedule instead of stacking up duplicates, and changing the cron here takes effect on boot.
await getQueue().upsertJobScheduler(
  JOB_NAMES.CLEANUP_NOTIFICATIONS,
  { pattern: CLEANUP_NOTIFICATIONS_CRON, tz: APP_TIME_ZONE },
  {
    name: JOB_NAMES.CLEANUP_NOTIFICATIONS,
    data: { jobType: JOB_NAMES.CLEANUP_NOTIFICATIONS, payload: {} },
  },
)
logger.info('Notification cleanup schedule registered', {
  event: 'worker.cleanup_schedule_registered',
  pattern: CLEANUP_NOTIFICATIONS_CRON,
  tz: APP_TIME_ZONE,
})

await getQueue().upsertJobScheduler(
  JOB_NAMES.CLEANUP_EXPORTS,
  { pattern: CLEANUP_EXPORTS_CRON, tz: APP_TIME_ZONE },
  {
    name: JOB_NAMES.CLEANUP_EXPORTS,
    data: { jobType: JOB_NAMES.CLEANUP_EXPORTS, payload: {} },
  },
)
logger.info('Export cleanup schedule registered', {
  event: 'worker.cleanup_schedule_registered',
  pattern: CLEANUP_EXPORTS_CRON,
  tz: APP_TIME_ZONE,
})

await getQueue().upsertJobScheduler(
  JOB_NAMES.SYNC_STATUSES,
  { pattern: SYNC_STATUSES_CRON, tz: APP_TIME_ZONE },
  {
    name: JOB_NAMES.SYNC_STATUSES,
    data: { jobType: JOB_NAMES.SYNC_STATUSES, payload: {} },
  },
)
logger.info('Status sync schedule registered', {
  event: 'worker.status_sync_schedule_registered',
  pattern: SYNC_STATUSES_CRON,
  tz: APP_TIME_ZONE,
})

await getQueue().upsertJobScheduler(
  JOB_NAMES.DATA_RETENTION,
  { pattern: DATA_RETENTION_CRON, tz: APP_TIME_ZONE },
  {
    name: JOB_NAMES.DATA_RETENTION,
    data: { jobType: JOB_NAMES.DATA_RETENTION, payload: {} },
  },
)
logger.info('Data retention schedule registered', {
  event: 'worker.cleanup_schedule_registered',
  pattern: DATA_RETENTION_CRON,
  tz: APP_TIME_ZONE,
  mode: retentionMode(),
})

await getQueue().upsertJobScheduler(
  JOB_NAMES.SCAN_EVENT_SOURCES,
  { pattern: SCAN_EVENT_SOURCES_CRON, tz: APP_TIME_ZONE },
  {
    name: JOB_NAMES.SCAN_EVENT_SOURCES,
    data: { jobType: JOB_NAMES.SCAN_EVENT_SOURCES, payload: {} },
  },
)
logger.info('Event source scan schedule registered', {
  event: 'worker.import_schedule_registered',
  pattern: SCAN_EVENT_SOURCES_CRON,
  tz: APP_TIME_ZONE,
})

const worker = spawnQueueWorker()

registerShutdown('Worker', [worker])
