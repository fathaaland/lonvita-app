import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import config from '@payload-config'
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import { HEARTBEAT_STALE_MS, pingRedis, readWorkerHeartbeat } from '@/lib/health/heartbeat'
import { logger, serializeError } from '@/lib/logger'
import { getEmailQueue } from '@/lib/queue/queues'

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
 * For an uptime monitor (BetterStack, UptimeRobot…), polled every minute: 200 when the database,
 * Redis and the worker are all there, 503 otherwise — the worker by its heartbeat, since it has no
 * public address of its own. Says which part is down and how many e-mails wait, nothing else.
 */
export async function GET() {
  const database = await check('database', async () => {
    const payload = await getPayload({ config })
    await (payload.db as unknown as PostgresAdapter).drizzle.execute(sql`SELECT 1`)
  })

  let heartbeatAt: number | null = null
  const redis = await check('redis', async () => {
    await pingRedis()
    heartbeatAt = await readWorkerHeartbeat()
  })
  const worker = heartbeatAt !== null && Date.now() - heartbeatAt < HEARTBEAT_STALE_MS

  let emailsWaiting: number | null = null
  if (redis) {
    await check('email-queue', async () => {
      emailsWaiting = await getEmailQueue().getWaitingCount()
    })
  }

  const ok = database && redis && worker
  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', database, redis, worker, emailsWaiting },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}
