import { Redis } from 'ioredis'

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
const parsedRedisUrl = new URL(redisUrl)

const useTls = parsedRedisUrl.protocol === 'rediss:'
const redisPort = Number(parsedRedisUrl.port || '6379')
const redisDb = Number(parsedRedisUrl.pathname.replace('/', '') || '0')

export const queueConnectionOptions = {
  host: parsedRedisUrl.hostname,
  port: Number.isNaN(redisPort) ? 6379 : redisPort,
  db: Number.isNaN(redisDb) ? 0 : redisDb,
  ...(parsedRedisUrl.username ? { username: decodeURIComponent(parsedRedisUrl.username) } : {}),
  ...(parsedRedisUrl.password ? { password: decodeURIComponent(parsedRedisUrl.password) } : {}),
  ...(useTls ? { tls: {} } : {}),
  // Required by BullMQ so it can manage retries itself instead of ioredis retrying underneath it.
  maxRetriesPerRequest: null,
  lazyConnect: true,
}
