import { queueConnectionOptions } from '@/lib/valkey/client'

export const queueOptions = {
  connection: queueConnectionOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 1000 },
    removeOnComplete: {
      age: 60 * 60 * 24,
      count: 500,
    },
    removeOnFail: {
      age: 60 * 60 * 24 * 7,
      count: 1000,
    },
  },
}

/**
 * Lock and stall settings for the one worker. BullMQ's defaults (30 s lock, a job failed after a
 * single stall) are tuned for jobs that never block the event loop; rendering an export PDF
 * does, and a long report would be declared stalled mid-render, run again, and then failed.
 * The lock is still renewed every 15 s while a job runs, so a crashed worker's jobs are picked up
 * within a minute.
 */
export const workerOptions = {
  lockDuration: 60_000,
  lockRenewTime: 15_000,
  stalledInterval: 30_000,
  maxStalledCount: 2,
}
