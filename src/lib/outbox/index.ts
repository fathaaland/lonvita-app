import { randomUUID } from 'node:crypto'

import { afterCommit } from '@/lib/after-commit'
import { logger, serializeError } from '@/lib/logger'
import { getCorrelationId } from '@/lib/logger/correlation'
import { JOB_NAMES } from '@/lib/queue/contracts'
import { enqueueEmail, enqueueEventCancelled, enqueueEventUpdated, enqueueSms } from '@/lib/queue/queues'

import type { Payload, PayloadRequest } from 'payload'
import type { QueueJobEnvelope } from '@/lib/queue/contracts'
import type { EnqueueOptions } from '@/lib/queue/queues'

/**
 * The transactional outbox — for the announcements that must not get lost between the database and
 * the queue: a cancelled or changed event, a message from its team, an SMS. Without it the job is
 * added once the change commits (afterCommit): Redis down at that moment, or the serverless function
 * frozen between the commit and the add, and nobody hears about the change. With it the job is first
 * written as a row (Outbox) — in the change's own transaction where there is one — and the worker's
 * relay (outbox-relay) hands over whatever is still not in the queue a minute later.
 *
 * At least once: every job carries a job id, so a relay of one that did reach the queue (the add went
 * through, marking the row didn't) is swallowed by BullMQ instead of announced twice.
 */
export type OutboxEnvelope = Extract<
  QueueJobEnvelope,
  { jobType: 'send-email' | 'send-sms' | 'event-updated' | 'event-cancelled' }
>

export type OutboxJob = {
  job: OutboxEnvelope
  /** Stable per announcement — the queue dedupes on it. A random one when the caller has none. */
  jobId?: string
  delay?: number
}

/** An Outbox row as read back — `job` is plain JSON there. */
export type OutboxRow = {
  id: number | string
  jobId: string
  job: unknown
  runAt?: string | null
  attempts?: number | null
}

/** A relay leaves a row alone for this long after it was written — the dispatch after commit is
 * normally done in milliseconds, and a relay in the middle of it would only add a no-op. */
export const OUTBOX_RELAY_GRACE_MS = 60_000
/** Still not in the queue this long after it was written: worth an alert (the relay's Sentry issue,
 * /api/health), not just another try. */
export const OUTBOX_STUCK_AFTER_MS = 10 * 60 * 1000
/** Past this, an announcement is no use any more (the event has long happened) — no longer relayed. */
export const OUTBOX_GIVE_UP_AFTER_MS = 48 * 60 * 60 * 1000

/** Into the queue through the job's own enqueue function — its queue, and its defaults (the edit
 * announcement's debounce) with it. */
const enqueue = (job: OutboxEnvelope, options: EnqueueOptions) => {
  switch (job.jobType) {
    case JOB_NAMES.SEND_EMAIL:
      return enqueueEmail(job.payload, options)
    case JOB_NAMES.SEND_SMS:
      return enqueueSms(job.payload, options)
    case JOB_NAMES.EVENT_UPDATED:
      return enqueueEventUpdated(job.payload, options)
    case JOB_NAMES.EVENT_CANCELLED:
      return enqueueEventCancelled(job.payload, options)
    default:
      throw new Error(`Not an outbox job: ${(job as QueueJobEnvelope).jobType}`)
  }
}

const enqueueOptions = (row: { jobId: string; job: OutboxEnvelope; runAt?: string | null }): EnqueueOptions => ({
  jobId: row.jobId,
  correlationId: row.job.correlationId,
  // From when the row was written — a relay much later doesn't push the job out further.
  ...(row.runAt ? { delay: Math.max(0, new Date(row.runAt).getTime() - Date.now()) } : {}),
})

const toRowData = (input: OutboxJob) => {
  const job = { ...input.job, correlationId: input.job.correlationId ?? getCorrelationId() }
  return {
    jobType: job.jobType,
    jobId: input.jobId ?? `${job.jobType}-${randomUUID()}`,
    job,
    runAt: input.delay ? new Date(Date.now() + input.delay).toISOString() : null,
    attempts: 0,
  }
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Adds the row's job to its queue and marks the row dispatched. Throws when the queue doesn't take
 * it (the attempt is recorded on the row first).
 */
export async function dispatchOutboxRow(payload: Payload, row: OutboxRow): Promise<void> {
  const attempts = (row.attempts ?? 0) + 1
  try {
    const job = row.job as OutboxEnvelope
    await enqueue(job, enqueueOptions({ ...row, job }))
  } catch (error) {
    await payload.db
      .updateOne({ collection: 'outbox', id: row.id, data: { attempts, lastError: errorMessage(error) } })
      .catch(() => undefined)
    throw error
  }
  await payload.db.updateOne({
    collection: 'outbox',
    id: row.id,
    data: { dispatchedAt: new Date().toISOString(), attempts, lastError: null },
  })
}

/**
 * Writes the job into the outbox in `req`'s transaction and hands it to the queue once that commits
 * (straight away when there's none). A rolled-back change takes its row with it — nobody hears about
 * what didn't happen. Throws only when the row can't be written, which fails the change too, as it
 * should; a queue that doesn't take the job is the relay's business.
 */
export async function enqueueThroughOutbox(req: PayloadRequest, input: OutboxJob): Promise<void> {
  const row = (await req.payload.create({
    collection: 'outbox',
    data: toRowData(input),
    depth: 0,
    overrideAccess: true,
    req,
  })) as unknown as OutboxRow
  await afterCommit(req, async () => {
    try {
      await dispatchOutboxRow(req.payload, row)
    } catch (error) {
      logger.warn('Outbox job left for the relay', {
        event: 'outbox.dispatch_deferred',
        outboxId: row.id,
        jobType: (row.job as OutboxEnvelope).jobType,
        jobId: row.jobId,
        ...serializeError(error),
      })
    }
  })
}

/**
 * For a job with no transaction to ride with (a worker's fan-out, a route that writes nothing first):
 * added to the queue straight away, and only one the queue doesn't take is parked in the outbox for
 * the relay — so a Redis outage delays the announcement instead of dropping it. Throws only when the
 * queue is down and the database too.
 */
export async function enqueueOrPark(payload: Payload, input: OutboxJob): Promise<'queued' | 'parked'> {
  const data = toRowData(input)
  try {
    await enqueue(data.job, enqueueOptions(data))
    return 'queued'
  } catch (error) {
    await payload.create({
      collection: 'outbox',
      data: { ...data, attempts: 1, lastError: errorMessage(error) },
      depth: 0,
      overrideAccess: true,
    })
    logger.warn('Queue unavailable — job parked in the outbox', {
      event: 'outbox.parked',
      jobType: data.jobType,
      jobId: data.jobId,
      ...serializeError(error),
    })
    return 'parked'
  }
}
