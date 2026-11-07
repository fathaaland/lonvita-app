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
 * E-mails and SMS: a provider that is down or throttling for a while (Resend's 429, a BulkGate outage,
 * a deploy) must not lose a cancellation notice — ten tries, 30 s doubling, spread over about eight
 * hours. Kept a week once done, so a job id (the announcement and the recipient) still swallows a
 * re-run of the same announcement for that long, however many thousand went out since.
 */
export const deliveryJobOptions = {
  attempts: 10,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { age: 60 * 60 * 24 * 7 },
  removeOnFail: { age: 60 * 60 * 24 * 14 },
}

/** Sends a second across all worker replicas (BullMQ's limiter is per queue, not per process).
 * Resend allows 2 requests a second unless the account was raised — set EMAIL_RATE_PER_SECOND then. */
const ratePerSecond = (envValue: string | undefined, fallback: number) => {
  const parsed = Number(envValue)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
export const emailRatePerSecond = () => ratePerSecond(process.env.EMAIL_RATE_PER_SECOND, 2)
export const smsRatePerSecond = () => ratePerSecond(process.env.SMS_RATE_PER_SECOND, 5)

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

/** E-mails waiting in the queue past which /api/health turns 503 and the worker reports to Sentry —
 * at the default 2 a second, a thousand is a backlog of about eight minutes (a cancellation of a
 * full event is a few hundred). EMAIL_BACKLOG_ALERT sets another. */
export const emailBacklogAlertThreshold = () => ratePerSecond(process.env.EMAIL_BACKLOG_ALERT, 1_000)
