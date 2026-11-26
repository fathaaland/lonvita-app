import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import config from '@payload-config'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import { HEARTBEAT_STALE_MS, pingRedis, readWorkerHeartbeats } from '@/lib/health/heartbeat'
import { logger, serializeError } from '@/lib/logger'
import { OUTBOX_GIVE_UP_AFTER_MS, OUTBOX_STUCK_AFTER_MS } from '@/lib/outbox'
import { EMAIL_QUEUE_NAME, HEAVY_QUEUE_NAME, QUEUE_NAME, SMS_QUEUE_NAME } from '@/lib/queue/contracts'
import { emailBacklogAlertThreshold } from '@/lib/queue/options'
import { getEmailQueue } from '@/lib/queue/queues'

/** Every queue some worker must be consuming. */
const WORKER_QUEUES = [QUEUE_NAME, EMAIL_QUEUE_NAME, SMS_QUEUE_NAME, HEAVY_QUEUE_NAME]

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Each check gets this long — a health check that hangs tells the monitor nothing. */
const CHECK_TIMEOUT_MS = 3_000

const within = <T>(promise: Promise<T>): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS)),
  ])

const check = async (name: string, run: () => Promise<unknown>): Promise<boolean> => {
  try {
    await within(run())
    return true
  } catch (error) {
    logger.warn('Health check failed', { event: 'health.check_failed', check: name, ...serializeError(error) })
    return false
  }
}

/**
 * For an uptime monitor (Sentry Uptime, BetterStack…), polled every minute: 200 when the database,
 * Redis and the worker are all there, the e-mails aren't piling up (EMAIL_BACKLOG_ALERT) and no
 * announcement is stuck in the outbox; 503 otherwise — the worker by its heartbeat, since it has no
 * public address of its own. Says which part is down and how many e-mails wait, nothing else.
 */
export async function GET() {
  const database = await check('database', async () => {
    const payload = await getPayload({ config })
    await (payload.db as unknown as PostgresAdapter).drizzle.execute(sql`SELECT 1`)
  })

  // One heartbeat per queue — the queues may be consumed by different worker services (WORKER_QUEUES).
  let heartbeats: Record<string, number | null> = {}
  const redis = await check('redis', async () => {
    await pingRedis()
    heartbeats = await readWorkerHeartbeats(WORKER_QUEUES)
  })
  const now = Date.now()
  const workerQueues = Object.fromEntries(
    WORKER_QUEUES.map((queue) => {
      const at = heartbeats[queue]
      return [queue, at != null && now - at < HEARTBEAT_STALE_MS]
    }),
  )
  const worker = redis && Object.values(workerQueues).every(Boolean)

  let emailsWaiting: number | null = null
  if (redis) {
    await check('email-queue', async () => {
      emailsWaiting = await getEmailQueue().getWaitingCount()
    })
  }
  // E-mails piling up — the provider down or throttling, or the worker not keeping up.
  const emailBacklog = emailsWaiting !== null && emailsWaiting > emailBacklogAlertThreshold()

  // Announcements written to the outbox that haven't reached the queue for a while (lib/outbox).
  let outboxStuck: number | null = null
  if (database) {
    await check('outbox', async () => {
      const payload = await getPayload({ config })
      const { rows } = await (payload.db as unknown as PostgresAdapter).drizzle.execute(sql`
        SELECT count(*)::int AS stuck FROM outbox
        WHERE dispatched_at IS NULL
          AND created_at < ${new Date(now - OUTBOX_STUCK_AFTER_MS).toISOString()}::timestamptz
          AND created_at > ${new Date(now - OUTBOX_GIVE_UP_AFTER_MS).toISOString()}::timestamptz`)
      outboxStuck = Number((rows[0] as { stuck?: number } | undefined)?.stuck ?? 0)
    })
  }

  const ok = database && redis && worker && !emailBacklog && !outboxStuck
  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', database, redis, worker, workerQueues, emailsWaiting, emailBacklog, outboxStuck },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
