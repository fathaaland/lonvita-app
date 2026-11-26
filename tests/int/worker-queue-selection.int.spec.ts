import { afterAll, describe, expect, it } from 'vitest'
import { Redis } from 'ioredis'

import {
  HEARTBEAT_STALE_MS,
  readWorkerHeartbeats,
  WORKER_HEARTBEAT_KEY,
  workerHeartbeatKey,
  writeWorkerHeartbeat,
} from '@/lib/health/heartbeat'
import { queueConnectionOptions } from '@/lib/valkey/client'

import { parseWorkerQueues } from '../../worker/src/runtime/queue-selection'

describe('parseWorkerQueues', () => {
  it('runs every queue when unset or "all"', () => {
    expect(parseWorkerQueues(undefined)).toEqual(['main', 'email', 'sms', 'heavy'])
    expect(parseWorkerQueues('')).toEqual(['main', 'email', 'sms', 'heavy'])
    expect(parseWorkerQueues(' ALL ')).toEqual(['main', 'email', 'sms', 'heavy'])
  })

  it('takes a list, in any order and case, without duplicates', () => {
    expect(parseWorkerQueues('sms, Main,email,main')).toEqual(['main', 'email', 'sms'])
    expect(parseWorkerQueues('heavy')).toEqual(['heavy'])
  })

  it('refuses an unknown name instead of leaving a queue nobody reads', () => {
    expect(() => parseWorkerQueues('main,emails')).toThrow(/emails/)
    expect(() => parseWorkerQueues(',')).toThrow()
  })
})

describe('worker heartbeats per queue', () => {
  const redis = new Redis({ ...queueConnectionOptions, lazyConnect: false })
  const queues = ['test-hb-core', 'test-hb-heavy']

  afterAll(async () => {
    await redis.del(...queues.map(workerHeartbeatKey))
    await redis.quit()
  })

  it('reports each queue by its own key, so a split service that is down shows up', async () => {
    await redis.del(...queues.map(workerHeartbeatKey))
    const legacy = await redis.get(WORKER_HEARTBEAT_KEY)
    await redis.del(WORKER_HEARTBEAT_KEY)
    try {
      await writeWorkerHeartbeat(['test-hb-core'], 1_000)
      expect(await readWorkerHeartbeats(queues)).toEqual({ 'test-hb-core': 1_000, 'test-hb-heavy': null })
      expect(await redis.pttl(workerHeartbeatKey('test-hb-core'))).toBeGreaterThan(HEARTBEAT_STALE_MS)
    } finally {
      if (legacy) await redis.set(WORKER_HEARTBEAT_KEY, legacy, 'PX', HEARTBEAT_STALE_MS)
    }
  })

  it('falls back to the single key an older worker writes', async () => {
    await redis.del(...queues.map(workerHeartbeatKey))
    await redis.set(WORKER_HEARTBEAT_KEY, '2000', 'PX', 5_000)
    await writeWorkerHeartbeat(['test-hb-heavy'], 3_000)
    expect(await readWorkerHeartbeats(queues)).toEqual({ 'test-hb-core': 2_000, 'test-hb-heavy': 3_000 })
    await redis.del(WORKER_HEARTBEAT_KEY)
  })
})
