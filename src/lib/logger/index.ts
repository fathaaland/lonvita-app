import { getCorrelationId } from './correlation'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogContext = Record<string, unknown>

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const consoleMethod: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
}

const resolveMinLevel = (): LogLevel => {
  const configured = process.env.LOG_LEVEL?.trim().toLowerCase()
  if (
    configured === 'debug' ||
    configured === 'info' ||
    configured === 'warn' ||
    configured === 'error'
  ) {
    return configured
  }
  // Every read of every collection produces a debug line (see collection-logger), which would
  // bury the signal and burn through the BetterStack quota in production for no benefit.
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

const minLevelWeight = LEVEL_WEIGHT[resolveMinLevel()]

/**
 * Which deployment a line came from. The web app leaves this at its default; the worker's
 * start script sets LOG_SERVICE=worker, so BetterStack can separate "Vercel" from "Railway"
 * without guessing from the message text.
 */
const service = process.env.LOG_SERVICE?.trim() || 'web'
const environment = process.env.VERCEL_ENV?.trim() || process.env.NODE_ENV || 'development'

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|credential/i
const MAX_DEPTH = 4

export const serializeError = (error: unknown): LogContext => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      // A stack in production log storage is a liability more than a help for handled errors;
      // the message plus the correlationId is enough to find the request.
      ...(process.env.NODE_ENV === 'production' ? {} : { stack: error.stack }),
    }
  }
  return { message: String(error) }
}

/**
 * Logs are shipped to a third party and kept for weeks, so nothing that could authenticate
 * anybody may travel with them. Keys are matched by name rather than value because that is the
 * part we control: a field called `password` never ships its contents, whatever they are.
 */
const redact = (value: unknown, depth = 0): unknown => {
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return '[truncated]'
  if (value instanceof Error) return serializeError(value)
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1))

  const out: LogContext = {}
  for (const [key, item] of Object.entries(value as LogContext)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, depth + 1)
  }
  return out
}

/**
 * Optional BetterStack Logs shipping. Verified HTTP contract (2026-09):
 *   POST https://<INGESTING_HOST>   (source-specific, not a fixed global endpoint)
 *   header: Authorization: Bearer <SOURCE_TOKEN>
 *   body:   { message, dt, level, ...customFields }
 * Both env vars come from a source's "Data ingestion" tab at betterstack.com. Absent either
 * one, this is a no-op — console logging (below) is always the baseline regardless.
 */
const betterStackToken = process.env.BETTERSTACK_SOURCE_TOKEN
const betterStackHost = process.env.BETTERSTACK_INGESTING_HOST

const pending = new Set<Promise<unknown>>()

type VercelRequestContext = {
  get?: () => { waitUntil?: (promise: Promise<unknown>) => void } | undefined
}

/**
 * A Vercel function instance can be frozen the instant it returns its response, which kills
 * any fetch still in flight — precisely what a fire-and-forget logger is, and the reason logs
 * from short request handlers never arrived. `waitUntil` keeps the instance alive until the
 * shipping request finishes. Reached through the platform's well-known symbol rather than
 * @vercel/functions so that this module stays importable by the worker, which runs on Railway
 * and has no such context (there the promise is simply tracked for flushLogs on shutdown).
 */
const keepAliveUntilSettled = (promise: Promise<unknown>) => {
  pending.add(promise)
  void promise.finally(() => pending.delete(promise))

  const context = (globalThis as Record<symbol, unknown>)[Symbol.for('@vercel/request-context')] as
    VercelRequestContext | undefined
  context?.get?.()?.waitUntil?.(promise)
}

function shipToBetterStack(level: LogLevel, message: string, fields: LogContext) {
  if (!betterStackToken || !betterStackHost) return

  const request = fetch(`https://${betterStackHost}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${betterStackToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, level, dt: new Date().toISOString(), ...fields }),
  }).catch(() => {
    // Deliberately silent — falling back to console (already logged below) is enough; a
    // console.error here about a logging failure would just be more noise to ship nowhere.
  })

  keepAliveUntilSettled(request)
}

const log = (level: LogLevel, message: string, context?: LogContext) => {
  if (LEVEL_WEIGHT[level] < minLevelWeight) return

  const fields: LogContext = {
    service,
    env: environment,
    correlationId: (context?.correlationId as string) || getCorrelationId(),
    ...(redact(context) as LogContext),
  }

  consoleMethod[level](
    JSON.stringify({ level, message, timestamp: new Date().toISOString(), ...fields }),
  )
  shipToBetterStack(level, message, fields)
}

export const logger = {
  debug: (message: string, context?: LogContext) => log('debug', message, context),
  info: (message: string, context?: LogContext) => log('info', message, context),
  warn: (message: string, context?: LogContext) => log('warn', message, context),
  error: (message: string, context?: LogContext) => log('error', message, context),
}

/** Let a long-running process (the worker, on shutdown) drain anything still in flight. */
export const flushLogs = async (): Promise<void> => {
  await Promise.allSettled([...pending])
}

export {
  getCorrelationId,
  runWithCorrelationId,
  correlationIdFromHeaders,
  CORRELATION_ID_HEADER,
} from './correlation'
