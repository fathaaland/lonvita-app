import { Redis } from 'ioredis'

import { logger, serializeError } from '@/lib/logger'
import { queueConnectionOptions } from '@/lib/valkey/client'

/**
 * Remembers that an SMS has gone out, per request id (the announcement and the recipient). BulkGate's
 * duplicates_check only covers five minutes, and a job is retried for hours (deliveryJobOptions) — a
 * send that went through but whose answer or acknowledgement was lost (a crash, a deploy, a stalled
 * job) would otherwise text the person again. The marker outlives every retry.
 *
 * Both calls fail open: with Redis unreachable the SMS is still sent (a cancellation notice must not
 * be lost) and BulkGate's own check remains.
 */
const MARKER_TTL_SECONDS = 14 * 24 * 60 * 60

const markerKey = (requestId: string) => `lonvita:sms-sent:${requestId}`

let client: Redis | undefined
const getClient = (): Redis => {
  if (!client) {
    client = new Redis({ ...queueConnectionOptions, lazyConnect: false, maxRetriesPerRequest: 1, commandTimeout: 2_000 })
    client.on('error', () => undefined)
  }
  return client
}

export async function wasSmsSent(requestId: string | undefined): Promise<boolean> {
  if (!requestId) return false
  try {
    return (await getClient().exists(markerKey(requestId))) === 1
  } catch (error) {
    logger.warn('SMS sent-marker unreadable', { event: 'sms.marker_read_failed', requestId, ...serializeError(error) })
    return false
  }
}

export async function markSmsSent(requestId: string | undefined): Promise<void> {
  if (!requestId) return
  try {
    await getClient().set(markerKey(requestId), '1', 'EX', MARKER_TTL_SECONDS)
  } catch (error) {
    logger.warn('SMS sent-marker not written', { event: 'sms.marker_write_failed', requestId, ...serializeError(error) })
  }
}
