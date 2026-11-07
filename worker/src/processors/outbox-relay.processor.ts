import { logger, serializeError } from '@/lib/logger'
import { dispatchOutboxRow, OUTBOX_GIVE_UP_AFTER_MS, OUTBOX_RELAY_GRACE_MS, OUTBOX_STUCK_AFTER_MS } from '@/lib/outbox'
import { emailBacklogAlertThreshold } from '@/lib/queue/options'
import { getEmailQueue } from '@/lib/queue/queues'

import { getWorkerPayload } from '../runtime/payload'
import { Sentry } from '../runtime/sentry'

import type { OutboxRelayJobResult } from '@/lib/queue/contracts'
import type { Payload } from 'payload'

/** Rows handed over per run — a backlog after an outage drains over a few minutes, not in one go. */
const RELAY_BATCH = 200
/** Dispatched rows are kept this long — enough to see what went out after an incident. */
const DISPATCHED_KEPT_MS = 7 * 24 * 60 * 60 * 1000
/** Rows never dispatched (given up on) are kept a while longer, for the same reason. */
const UNDISPATCHED_KEPT_MS = 14 * 24 * 60 * 60 * 1000

const ago = (ms: number, now: number) => new Date(now - ms).toISOString()

async function relayPending(payload: Payload, now: number) {
  const pending = await payload.find({
    collection: 'outbox',
    where: {
      and: [
        { dispatchedAt: { exists: false } },
        { createdAt: { less_than: ago(OUTBOX_RELAY_GRACE_MS, now) } },
        { createdAt: { greater_than: ago(OUTBOX_GIVE_UP_AFTER_MS, now) } },
      ],
    },
    sort: 'createdAt',
    limit: RELAY_BATCH,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  let relayed = 0
  let failed = 0
  for (const row of pending.docs) {
    try {
      await dispatchOutboxRow(payload, row)
      relayed++
    } catch (error) {
      failed++
      logger.warn('Outbox job not relayed', {
        event: 'outbox.relay_failed',
        outboxId: row.id,
        jobType: row.jobType,
        jobId: row.jobId,
        attempts: (row.attempts ?? 0) + 1,
        ...serializeError(error),
      })
      // Redis is down for all of them, most likely — the next run tries again.
      break
    }
  }
  return { relayed, failed }
}

async function purgeOld(payload: Payload, now: number): Promise<number> {
  const old = await payload.find({
    collection: 'outbox',
    where: {
      or: [
        { dispatchedAt: { less_than: ago(DISPATCHED_KEPT_MS, now) } },
        {
          and: [
            { dispatchedAt: { exists: false } },
            { createdAt: { less_than: ago(UNDISPATCHED_KEPT_MS, now) } },
          ],
        },
      ],
    },
    select: {},
    limit: 1_000,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  if (old.docs.length === 0) return 0
  // Straight to the adapter: nothing hangs on an outbox row, and no hooks need to hear of it.
  await payload.db.deleteMany({ collection: 'outbox', where: { id: { in: old.docs.map((doc) => doc.id) } } })
  return old.docs.length
}

async function countStuck(payload: Payload, now: number): Promise<number> {
  const { totalDocs } = await payload.count({
    collection: 'outbox',
    where: {
      and: [
        { dispatchedAt: { exists: false } },
        { createdAt: { less_than: ago(OUTBOX_STUCK_AFTER_MS, now) } },
        { createdAt: { greater_than: ago(OUTBOX_GIVE_UP_AFTER_MS, now) } },
      ],
    },
    overrideAccess: true,
  })
  return totalDocs
}

/**
 * The outbox's relay (lib/outbox), every minute. An announcement whose job didn't reach the queue
 * after its change committed — Redis down, a function frozen in between — goes in now, under the job
 * id it was written with, so one that did make it is not doubled. And the two things to be woken up
 * for: announcements stuck for ten minutes, and e-mails piling up in their queue (the provider down or
 * throttling) — both to Sentry, grouped into one issue each.
 */
export const processOutboxRelayJob = async (): Promise<OutboxRelayJobResult> => {
  const payload = await getWorkerPayload()
  const now = Date.now()

  const { relayed, failed } = await relayPending(payload, now)
  const purged = await purgeOld(payload, now).catch((error) => {
    logger.warn('Outbox purge failed', { event: 'outbox.purge_failed', ...serializeError(error) })
    return 0
  })
  const stuck = await countStuck(payload, now)

  if (relayed > 0) {
    logger.warn('Outbox jobs relayed', { event: 'outbox.relayed', relayed })
  }
  if (stuck > 0) {
    logger.error('Announcements stuck in the outbox', { event: 'outbox.stuck', stuck })
    Sentry.captureMessage('Announcements stuck in the outbox — not reaching the queue', {
      level: 'error',
      fingerprint: ['outbox-stuck'],
      extra: { stuck, relayed, failed },
    })
  }

  let emailsWaiting: number | null = null
  try {
    emailsWaiting = await getEmailQueue().getWaitingCount()
  } catch (error) {
    logger.warn('E-mail queue length unknown', { event: 'outbox.email_backlog_unknown', ...serializeError(error) })
  }
  const threshold = emailBacklogAlertThreshold()
  if (emailsWaiting !== null && emailsWaiting > threshold) {
    logger.error('E-mails piling up in the queue', { event: 'queue.email_backlog', emailsWaiting, threshold })
    Sentry.captureMessage('E-mails piling up in the queue', {
      level: 'warning',
      fingerprint: ['email-queue-backlog'],
      extra: { emailsWaiting, threshold },
    })
  }

  return { relayed, failed, purged, stuck, emailsWaiting }
}
