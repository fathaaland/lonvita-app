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

/**
 * A worker writes one of these per queue it consumes every HEARTBEAT_INTERVAL_MS; /api/health reads
 * them. Per queue, because the queues may be split across services (WORKER_QUEUES) and each service
 * may run several replicas: any live replica keeps its queues' keys fresh, and a service that is down
 * shows as its own queues going stale. In the queue's Redis, so a worker that can't reach Redis (and
 * so can't process anything) also stops looking alive.
 */
export const WORKER_HEARTBEAT_KEY = 'lonvita:worker:heartbeat'
export const workerHeartbeatKey = (queue: string) => `${WORKER_HEARTBEAT_KEY}:${queue}`
export const HEARTBEAT_INTERVAL_MS = 30_000
/** Missed for this long, the worker counts as down — a few beats, so one slow write isn't an alarm. */
export const HEARTBEAT_STALE_MS = 3 * 60_000

export async function writeWorkerHeartbeat(queues: readonly string[], now = Date.now()): Promise<void> {
  const ttl = HEARTBEAT_STALE_MS * 2
  const pipeline = getClient().pipeline()
  for (const queue of queues) pipeline.set(workerHeartbeatKey(queue), String(now), 'PX', ttl)
  const results = await pipeline.exec()
  const failed = results?.find(([error]) => error)
  if (failed) throw failed[0]
}

const timestampOf = (value: string | null | undefined): number | null => {
  const at = Number(value)
  return value && Number.isFinite(at) ? at : null
}

/**
 * When each queue's worker last checked in, null for one that hasn't within the key's lifetime. A
 * worker from before the per-queue keys wrote only WORKER_HEARTBEAT_KEY (for all of its queues) —
 * read as the fallback, so a web deploy that lands before the worker's doesn't report it down.
 */
export async function readWorkerHeartbeats(queues: readonly string[]): Promise<Record<string, number | null>> {
  const values = await getClient().mget(...queues.map(workerHeartbeatKey), WORKER_HEARTBEAT_KEY)
  const legacy = timestampOf(values[queues.length])
  return Object.fromEntries(queues.map((queue, i) => [queue, timestampOf(values[i]) ?? legacy]))
}
