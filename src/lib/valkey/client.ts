import { Redis } from 'ioredis'

// Local development and tests only. A deployment without REDIS_URL would otherwise quietly aim every
// queue at a localhost nobody runs there — e-mails "sent" into nowhere; validateEnv reports it too.
const redisUrl =
  process.env.REDIS_URL ||
  (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build'
    ? (() => {
        throw new Error('REDIS_URL is not set — the job queue, rate limits and live capacity need it.')
      })()
    : 'redis://localhost:6379')
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
