import { createHash } from 'node:crypto'

import Redis from 'ioredis'

import { logger } from '@/lib/logger'
import { serializeError } from '@/lib/logger/serialize-error'

export type RateLimitConfig = {
  max: number
  windowSeconds: number
}

export type RateLimitResult = {
  allowed: boolean
  retryAfter: number
  /** Set when the limiter itself could not answer and `failureMode: 'deny'` turned that away. */
  unavailable?: boolean
}

/** What to do when the backend can't be reached: stay usable (`allow`, the default — sign-in must
 * not go down with Redis) or refuse (`deny`, for endpoints where an unmetered caller is worse). */
type RateLimitFailureMode = 'allow' | 'deny'

type RateLimitStore = Pick<Redis, 'eval'>

/**
 * Endpoints metered in `src/proxy.ts`, before any route code runs — for the ones whose handler
 * isn't ours (Payload's own auth REST + GraphQL) or that should be turned away before they
 * do any work. Keyed by pathname, POST only. Per client IP, so set with shared addresses in
 * mind: a seniors' club signing in together from one obec Wi-Fi must not hit the login limit.
 * Brute force on a single account is Payload's own job (Users.auth.maxLoginAttempts); this is
 * the cap on one address trying many accounts.
 */
export const PROXY_RATE_LIMITS: Record<string, RateLimitConfig & { message: string }> = {
  '/api/users/login': {
    max: 20,
    windowSeconds: 15 * 60,
    message: 'Příliš mnoho pokusů o přihlášení. Zkuste to znovu za 15 minut.',
  },
  '/api/auth/register': {
    max: 20,
    windowSeconds: 60 * 60,
    message: 'Příliš mnoho registrací z této sítě. Zkuste to znovu za hodinu.',
  },
  // Payload's built-in password-reset endpoints are reachable next to our own /api/auth/* ones
  // (which carry their own limit, enforcePasswordResetRateLimit) — without this they would be
  // an unmetered way to send reset e-mails to anybody.
  '/api/users/forgot-password': {
    max: 5,
    windowSeconds: 15 * 60,
    message: 'Příliš mnoho žádostí o obnovení hesla. Zkuste to znovu za 15 minut.',
  },
  '/api/users/reset-password': {
    max: 5,
    windowSeconds: 15 * 60,
    message: 'Příliš mnoho pokusů o obnovení hesla. Zkuste to znovu za 15 minut.',
  },
  // GraphQL carries a login mutation of its own, so leaving it open would undo the login limit.
  '/api/graphql': {
    max: 60,
    windowSeconds: 60,
    message: 'Příliš mnoho požadavků. Zkuste to znovu za minutu.',
  },
  '/api/seed': {
    max: 5,
    windowSeconds: 15 * 60,
    message: 'Příliš mnoho požadavků. Zkuste to znovu za 15 minut.',
  },
}

const PASSWORD_RESET_ACTION_LIMIT: RateLimitConfig = {
  max: 5,
  windowSeconds: 15 * 60,
}

const MAX_CLIENT_IP_LENGTH = 256

let redis: RateLimitStore | null | undefined

const getRedis = (): RateLimitStore | null => {
  if (redis !== undefined) return redis

  if (process.env.REDIS_URL) {
    const client = new Redis(process.env.REDIS_URL, {
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    })

    client.on('error', () => undefined)
    redis = client
  } else {
    redis = null
  }

  return redis
}

const hashIdentifier = (identifier: string): string => createHash('sha256').update(identifier).digest('hex')

/**
 * Count and expiry in one step. As two separate calls, a process dying between INCR and EXPIRE
 * leaves a counter with no TTL — a permanent lockout for whoever it belongs to. A counter found
 * without one (left behind exactly like that) gets its window back here instead of living on.
 */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`

export const getClientIp = (requestHeaders: { get: (name: string) => string | null }): string => {
  const forwardedFor = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (forwardedFor || requestHeaders.get('x-real-ip')?.trim() || 'unknown').slice(0, MAX_CLIENT_IP_LENGTH)
}

export const consumeRateLimit = async ({
  namespace,
  identifier,
  max,
  windowSeconds,
  store = getRedis(),
  failureMode = 'allow',
}: {
  namespace: string
  identifier: string
  max: number
  windowSeconds: number
  store?: RateLimitStore | null
  failureMode?: RateLimitFailureMode
}): Promise<RateLimitResult> => {
  const retryAfter = windowSeconds
  const unavailableResult: RateLimitResult =
    failureMode === 'deny' ? { allowed: false, retryAfter, unavailable: true } : { allowed: true, retryAfter }

  if (!store) {
    return unavailableResult
  }

  const key = `ratelimit:${namespace}:${hashIdentifier(identifier)}`

  try {
    const [count, ttl] = (await store.eval(HIT_SCRIPT, 1, key, String(windowSeconds))) as [number, number]

    if (count <= max) {
      return { allowed: true, retryAfter }
    }

    logger.warn('Rate limit exceeded', {
      event: 'security.rate_limit_exceeded',
      namespace,
      max,
      windowSeconds,
      count,
    })

    return {
      allowed: false,
      retryAfter: ttl > 0 ? ttl : retryAfter,
    }
  } catch (error) {
    // By default this keeps authentication usable when the rate-limit backend is unavailable.
    // Failing *open* has to be loud: until it shows up in the log, the app silently has no
    // rate limiting at all.
    logger.error('Rate limit backend unavailable', {
      event: 'security.rate_limit_backend_unavailable',
      namespace,
      failureMode,
      ...serializeError(error),
    })
    return unavailableResult
  }
}

export const enforcePasswordResetRateLimit = async ({
  operation,
  requestHeaders,
  email,
}: {
  operation: 'forgot-password' | 'reset-password'
  requestHeaders: { get: (name: string) => string | null }
  email?: string
}): Promise<RateLimitResult> => {
  const identifiers = [
    {
      namespace: `password-reset-action:${operation}:ip`,
      value: getClientIp(requestHeaders),
    },
  ]

  if (operation === 'forgot-password' && email) {
    identifiers.push({
      namespace: `password-reset-action:${operation}:email`,
      value: email,
    })
  }

  const results = await Promise.all(
    identifiers.map(({ namespace, value }) =>
      consumeRateLimit({
        namespace,
        identifier: value,
        ...PASSWORD_RESET_ACTION_LIMIT,
      }),
    ),
  )

  const blocked = results.filter((result) => !result.allowed)
  if (blocked.length === 0) {
    return { allowed: true, retryAfter: PASSWORD_RESET_ACTION_LIMIT.windowSeconds }
  }

  return {
    allowed: false,
    retryAfter: Math.max(...blocked.map((result) => result.retryAfter)),
  }
}
