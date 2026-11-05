import { Redis } from 'ioredis'

import { queueConnectionOptions } from '@/lib/valkey/client'

let client: Redis | undefined

/** Its own connection with a command timeout — the queue's waits for Redis indefinitely, which is
 * right for jobs and wrong for a health check. */
const getClient = (): Redis => {
  if (!client) {
    client = new Redis({ ...queueConnectionOptions, lazyConnect: false, maxRetriesPerRequest: 1, commandTimeout: 2_000 })
    client.on('error', () => undefined)
  }
  return client
}

export async function pingRedis(): Promise<void> {
  await getClient().ping()
}

/** The worker writes this every HEARTBEAT_INTERVAL_MS; /api/health reads it. In the queue's Redis, so
 * a worker that can't reach Redis (and so can't process anything) also stops looking alive. */
export const WORKER_HEARTBEAT_KEY = 'lonvita:worker:heartbeat'
export const HEARTBEAT_INTERVAL_MS = 30_000
/** Missed for this long, the worker counts as down — a few beats, so one slow write isn't an alarm. */
export const HEARTBEAT_STALE_MS = 3 * 60_000

export async function writeWorkerHeartbeat(now = Date.now()): Promise<void> {
  await getClient().set(WORKER_HEARTBEAT_KEY, String(now), 'PX', HEARTBEAT_STALE_MS * 2)
}

/** When the worker last checked in, or null if it hasn't within the key's lifetime. */
export async function readWorkerHeartbeat(): Promise<number | null> {
  const value = await getClient().get(WORKER_HEARTBEAT_KEY)
  const at = Number(value)
  return value && Number.isFinite(at) ? at : null
}
