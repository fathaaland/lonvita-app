import { randomUUID } from 'node:crypto'

import { Redis } from 'ioredis'

import { logger, serializeError } from '@/lib/logger'
import { queueConnectionOptions } from '@/lib/valkey/client'

/**
 * Quota parts held by SMS that are queued but not yet sent. The quota counts sent SMS
 * (sms-messages), so without this two announcements of the same obec deciding at once both see the
 * same parts left and together text past it. Deciding happens under a per-obec lock and reserves
 * the parts it hands out; the worker gives them back once the SMS is sent, refused or failed for
 * good.
 *
 * One entry per SMS (a sorted set: member `requestId|parts`, score = when it lapses), so each
 * reservation lapses on its own — a busy obec queueing more doesn't keep an old, lost one alive, and
 * giving back the same SMS twice (a retry) takes it off only once. A reservation nobody gave back (a
 * job lost to a crash) counts as used until it lapses, which errs on the side of not texting.
 */
const RESERVATION_TTL_MS = 2 * 24 * 60 * 60 * 1000
const LOCK_TTL_MS = 15_000
const LOCK_WAIT_MS = 5_000

const heldKey = (municipalityId: number) => `lonvita:sms-held:${municipalityId}`
/** The single counter used before per-SMS entries — read and given back until its last key lapses. */
const legacyPendingKey = (municipalityId: number) => `lonvita:sms-pending:${municipalityId}`
const lockKey = (municipalityId: number) => `lonvita:sms-quota-lock:${municipalityId}`
const member = (requestId: string, parts: number) => `${requestId}|${parts}`

let client: Redis | undefined
const getClient = (): Redis => {
  if (!client) {
    client = new Redis({ ...queueConnectionOptions, lazyConnect: false, maxRetriesPerRequest: 1, commandTimeout: 2_000 })
    client.on('error', () => undefined)
  }
  return client
}

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`

/** Drops what lapsed, then sums the parts still held (plus the legacy counter). */
const HELD_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
local total = tonumber(redis.call('GET', KEYS[2]) or '0') or 0
for _, m in ipairs(redis.call('ZRANGE', KEYS[1], 0, -1)) do
  local parts = tonumber(string.match(m, '|(%d+)$'))
  if parts then total = total + parts end
end
return total
`

/** Off the set; an SMS reserved on the legacy counter is taken off that one (never below zero, and
 * never creating the key again once it lapsed). */
const GIVE_BACK_SCRIPT = `
if redis.call('ZREM', KEYS[1], ARGV[1]) == 1 then return 1 end
if redis.call('EXISTS', KEYS[2]) == 1 then
  local left = redis.call('DECRBY', KEYS[2], ARGV[2])
  if left < 0 then redis.call('SET', KEYS[2], 0, 'KEEPTTL') end
end
return 0
`

export type SmsReservation = { requestId: string; parts: number }

/**
 * Runs `decide` while holding the obec's quota lock. `decide` gets the parts currently reserved and
 * returns the SMS it reserves. Without Redis (or if the lock can't be had in time) it still runs,
 * unlocked and seeing no reservations — the announcement matters more than a few parts, and the
 * worker's ledger (sms-ledger) has the last word anyway.
 */
export async function withSmsQuotaReservation<T>(
  municipalityId: number,
  decide: (reservedParts: number) => Promise<{ result: T; reserve: SmsReservation[] }>,
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
    reserved = await heldParts(redis, municipalityId)
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
    if (reserve.length > 0) {
      const lapses = Date.now() + RESERVATION_TTL_MS
      await redis
        .multi()
        .zadd(heldKey(municipalityId), ...reserve.flatMap((r) => [lapses, member(r.requestId, r.parts)]))
        // The key outlives its newest entry; every entry still lapses on its own score.
        .pexpire(heldKey(municipalityId), RESERVATION_TTL_MS)
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
    if (locked) await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey(municipalityId), token).catch(() => undefined)
  }
}

const heldParts = async (redis: Redis, municipalityId: number): Promise<number> =>
  Number(await redis.eval(HELD_SCRIPT, 2, heldKey(municipalityId), legacyPendingKey(municipalityId), String(Date.now()))) || 0

/** Parts held by queued SMS right now, read without the lock — for a preview, never for deciding. */
export async function smsPartsHeld(municipalityId: number): Promise<number> {
  try {
    return await heldParts(getClient(), municipalityId)
  } catch {
    return 0
  }
}

/** The worker, once a reserved SMS is sent and recorded, refused, or failed for good. Giving back
 * the same SMS twice takes it off once. */
export async function releaseSmsReservation(
  municipalityId: number,
  requestId: string | undefined,
  parts: number,
): Promise<void> {
  if (parts <= 0) return
  await getClient()
    .eval(
      GIVE_BACK_SCRIPT,
      2,
      heldKey(municipalityId),
      legacyPendingKey(municipalityId),
      member(requestId ?? '', parts),
      String(parts),
    )
    .catch((error) =>
      logger.warn('SMS quota reservation not released', {
        event: 'sms.quota_release_failed',
        municipalityId,
        ...serializeError(error),
      }),
    )
}

/** Every reservation of the obec gone — tests, and a superadmin putting a stuck obec right. */
export async function clearSmsReservations(municipalityId: number): Promise<void> {
  await getClient().del(heldKey(municipalityId), legacyPendingKey(municipalityId))
}
