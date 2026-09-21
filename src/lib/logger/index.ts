import { getCorrelationId } from './correlation'
import { serializeError } from './serialize-error'

export { serializeError } from './serialize-error'

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
const betterStackToken = process.env.BETTERSTACK_SOURCE_TOKEN?.trim()
// Normalised rather than taken literally: these are pasted into a dashboard by hand, and a
// trailing newline or a leading `https://` turns the URL below into one fetch() refuses to
// parse — which, being a rejected promise, used to vanish without a trace.
const betterStackHost = process.env.BETTERSTACK_INGESTING_HOST?.trim()
  .replace(/^https?:\/\//i, '')
  .replace(/\/+$/, '')

/** Whether this deployment can ship at all, stated once per cold start. The alternative is
 * what happened the first time: a silent no-op that looks exactly like a working logger. */
console.info(
  JSON.stringify({
    level: 'info',
    message: 'logger.betterstack_config',
    service,
    env: environment,
    enabled: Boolean(betterStackToken && betterStackHost),
    // Shapes only — never the values. Enough to tell "missing" from "pasted with a newline".
    tokenLength: betterStackToken?.length ?? 0,
    hostLength: betterStackHost?.length ?? 0,
  }),
)

const pending = new Set<Promise<unknown>>()

let keepAliveReported = false

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
  const waitUntil = context?.get?.()?.waitUntil

  // Said once per cold start: if the platform hands out no waitUntil, every line shipped from a
  // short handler is a race against the instance being frozen, and losing it looks like silence.
  if (!keepAliveReported) {
    keepAliveReported = true
    console.info(
      JSON.stringify({
        level: 'info',
        message: 'logger.keepalive',
        service,
        env: environment,
        waitUntilAvailable: typeof waitUntil === 'function',
      }),
    )
  }

  waitUntil?.(promise)
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
  })
    .then(async (response) => {
      if (response.ok) return
      // A rejected token or a wrong host answers with a perfectly ordinary 4xx that a bare
      // fire-and-forget fetch throws away. Reported through console on purpose: routing it
      // back through `logger` would try to ship the report with the same broken settings.
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'logger.betterstack_rejected',
          status: response.status,
          body: (await response.text().catch(() => '')).slice(0, 200),
        }),
      )
    })
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          level: 'error',
          message: 'logger.betterstack_unreachable',
          reason: error instanceof Error ? error.message : String(error),
        }),
      )
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
