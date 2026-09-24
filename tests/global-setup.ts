import 'dotenv/config'

import { Queue } from 'bullmq'

import { QUEUE_NAME } from '@/lib/queue/contracts'

import { TEST_REDIS_URL } from './redis'

/** Nothing ever processes the jobs tests enqueue, so drop them once the run is over. */
export async function teardown() {
  const url = new URL(TEST_REDIS_URL)
  const queue = new Queue(QUEUE_NAME, {
    connection: {
      host: url.hostname,
      port: Number(url.port || '6379'),
      db: Number(url.pathname.slice(1)),
      ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
      ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    },
  })
  await queue.obliterate({ force: true }).catch(() => {})
  await queue.close()
}
