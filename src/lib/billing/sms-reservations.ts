import { randomUUID } from 'node:crypto'

import { Redis } from 'ioredis'

import { logger, serializeError } from '@/lib/logger'
import { queueConnectionOptions } from '@/lib/valkey/client'

/**
 * Quota parts held by SMS that are queued but not yet sent. The quota counts sent SMS
 * (sms-messages), so without this two announcements of the same obec deciding at once both see the
 * same parts left and together text past it. Deciding happens under a per-obec lock and reserves
 * the parts it hands out; the worker gives them back once the SMS is sent and recorded. A
 * reservation whose SMS never went out (failed for good) expires with the key — until then it
 * counts as used, which errs on the side of not texting.
 */
const RESERVATION_TTL_SECONDS = 2 * 24 * 60 * 60
const LOCK_TTL_MS = 15_000
const LOCK_WAIT_MS = 5_000

const pendingKey = (municipalityId: number) => `lonvita:sms-pending:${municipalityId}`
const lockKey = (municipalityId: number) => `lonvita:sms-quota-lock:${municipalityId}`

let client: Redis | undefined
const getClient = (): Redis => {
  if (!client) {
    client = new Redis({ ...queueConnectionOptions, lazyConnect: false, maxRetriesPerRequest: 1, commandTimeout: 2_000 })
    client.on('error', () => undefined)
  }
  return client
}

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`

/** Never below zero — a job queued before reservations existed gives back parts nobody held. */
const GIVE_BACK_SCRIPT = `
local left = redis.call('DECRBY', KEYS[1], ARGV[1])
if left < 0 then redis.call('SET', KEYS[1], 0, 'KEEPTTL') end
return 0
`

/**
 * Runs `decide` while holding the obec's quota lock. `decide` gets the parts currently reserved and
 * returns how many more it reserves. Without Redis (or if the lock can't be had in time) it still
 * runs, unlocked and seeing no reservations — the announcement matters more than a few parts.
 */
export async function withSmsQuotaReservation<T>(
  municipalityId: number,
  decide: (reservedParts: number) => Promise<{ result: T; reserve: number }>,
): Promise<T> {
  const redis = getClient()
  const token = randomUUID()
  let locked = false
  let reserved = 0
  try {
    const deadline = Date.now() + LOCK_WAIT_MS
    while (!locked && Date.now() < deadline) {
      locked = (await redis.set(lockKey(municipalityId), token, 'PX', LOCK_TTL_MS, 'NX')) === 'OK'
      if (!locked) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    reserved = Number(await redis.get(pendingKey(municipalityId))) || 0
  } catch (error) {
    logger.warn('SMS quota lock unavailable — deciding without it', {
      event: 'sms.quota_lock_unavailable',
      municipalityId,
      ...serializeError(error),
    })
  }
  if (!locked) {
    logger.warn('SMS quota decided without the lock', { event: 'sms.quota_unlocked', municipalityId })
  }

  try {
    const { result, reserve } = await decide(reserved)
    if (reserve > 0) {
      await redis
        .multi()
        .incrby(pendingKey(municipalityId), reserve)
        .expire(pendingKey(municipalityId), RESERVATION_TTL_SECONDS)
        .exec()
        .catch((error) =>
          logger.warn('SMS quota reservation not stored', {
            event: 'sms.quota_reservation_failed',
            municipalityId,
            ...serializeError(error),
          }),
        )
    }
    return result
  } finally {
    if (locked) await redis.eval(RELEASE_SCRIPT, 1, lockKey(municipalityId), token).catch(() => undefined)
  }
}

/** The worker, once a reserved SMS is sent and recorded in sms-messages. */
export async function releaseSmsReservation(municipalityId: number, parts: number): Promise<void> {
  if (parts <= 0) return
  await getClient()
    .eval(GIVE_BACK_SCRIPT, 1, pendingKey(municipalityId), String(parts))
    .catch((error) =>
      logger.warn('SMS quota reservation not released', {
        event: 'sms.quota_release_failed',
        municipalityId,
        ...serializeError(error),
      }),
    )
}
