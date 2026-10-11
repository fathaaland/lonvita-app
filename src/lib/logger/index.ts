import { Logtail } from '@logtail/node'

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
 * Optional BetterStack Logs shipping, through the vendor's own SDK. Both env vars come from a
 * source's "Data ingestion" tab at betterstack.com; without a token this is a no-op and the
 * console mirror below is the only output, which is what local development wants anyway.
 */
// Normalised rather than taken literally: it is pasted into a dashboard by hand, and a trailing
// newline or a leading `https://` turns the endpoint into one the SDK cannot reach.
const normaliseHost = (value: string | undefined) =>
  value?.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')

const createShipper = (token: string | undefined, host: string | undefined) => {
  if (!token) return null
  const shipper = new Logtail(token, {
    // Sources created recently get their own ingesting host. The SDK's built-in default
    // (in.logs.betterstack.com) accepts our token too, so a missing host is not fatal.
    ...(host ? { endpoint: `https://${host}` } : {}),
    // A Vercel instance can be frozen the moment it replies. Waiting the stock full second
    // for a batch to fill up means holding the instance open that long on every request.
    batchInterval: 250,
    // Never let a logging problem become a request problem — but do not swallow it either:
    // with both of these false the SDK console.errors what went wrong, which is exactly the
    // visibility whose absence made this integration look like it was working for weeks.
    throwExceptions: false,
    ignoreExceptions: false,
    // The console mirror below already prints every line, as JSON.
    sendLogsToConsoleOutput: false,
  })
  // Stamped onto the shipped copy of every line, so one BetterStack source can hold the web app
  // and the worker, production and preview, and still be filterable.
  shipper.use(async (log) => ({ ...log, service, env: environment }))
  return shipper
}

const betterStackToken = process.env.BETTERSTACK_SOURCE_TOKEN?.trim()
const betterStackHost = normaliseHost(process.env.BETTERSTACK_INGESTING_HOST)
const logtail = createShipper(betterStackToken, betterStackHost)

/**
 * The audit trail's copy outside the app — its own BetterStack source, so that one can be kept
 * 18 months or more (vyhláška č. 409/2025 Sb. § 22 odst. 5: integrity of the records, a central
 * tool) while the bulk of the logs stays on a short, cheap retention. Someone who gets hold of the
 * application or its database can't reach this copy. Without its token, audit lines still go to
 * the main source like every other line.
 */
const auditToken = process.env.BETTERSTACK_AUDIT_SOURCE_TOKEN?.trim()
const auditLogtail = createShipper(auditToken, normaliseHost(process.env.BETTERSTACK_AUDIT_INGESTING_HOST))

/** Whether this deployment can ship at all, stated once per cold start. The alternative is
 * what happened the first time: a silent no-op that looks exactly like a working logger. */
console.info(
  JSON.stringify({
    level: 'info',
    message: 'logger.betterstack_config',
    service,
    env: environment,
    enabled: Boolean(logtail),
    auditEnabled: Boolean(auditLogtail),
    // Shapes only — never the values. Enough to tell "missing" from "pasted with a newline".
    tokenLength: betterStackToken?.length ?? 0,
    hostLength: betterStackHost?.length ?? 0,
    auditTokenLength: auditToken?.length ?? 0,
  }),
)

const pending = new Set<Promise<unknown>>()

let keepAliveReported = false

type VercelRequestContext = {
  get?: () => { waitUntil?: (promise: Promise<unknown>) => void } | undefined
}

/**
 * A Vercel function instance can be frozen the instant it returns its response, which kills
 * any request still in flight — precisely what a fire-and-forget logger is, and the reason logs
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

const log = (level: LogLevel, message: string, context?: LogContext, audit = false) => {
  // The audit trail isn't diagnostics — LOG_LEVEL never thins it out.
  if (!audit && LEVEL_WEIGHT[level] < minLevelWeight) return

  const fields: LogContext = {
    correlationId: (context?.correlationId as string) || getCorrelationId(),
    ...(redact(context) as LogContext),
  }

  consoleMethod[level](
    JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(),
      service,
      env: environment,
      ...fields,
    }),
  )

  // The SDK's log() settles only once the line has actually been synced, so this promise is
  // the one thing that has to outlive the request that produced it.
  if (logtail) keepAliveUntilSettled(logtail[level](message, fields))
  if (audit && auditLogtail) keepAliveUntilSettled(auditLogtail[level](message, fields))
}

export const logger = {
  debug: (message: string, context?: LogContext) => log('debug', message, context),
  info: (message: string, context?: LogContext) => log('info', message, context),
  warn: (message: string, context?: LogContext) => log('warn', message, context),
  error: (message: string, context?: LogContext) => log('error', message, context),
  /**
   * BetterStack knows four levels, so "the app is broken, not just this request" has to travel
   * as a field. Kept as its own method because the call sites that deserve it — an unhandled
   * Payload error, a worker that cannot start — should be greppable.
   */
  fatal: (message: string, context?: LogContext) =>
    log('error', `[FATAL] ${message}`, { ...context, severity: 'fatal' }),
  /**
   * Who did what security-relevant from where — sign-ins and sign-outs (failed ones too), password
   * resets, and a copy of every audit-log entry (collections/shared/auditLog). Goes everywhere an
   * info line goes, whatever LOG_LEVEL says, and to the audit source as well.
   */
  audit: (message: string, context?: LogContext, level: 'info' | 'warn' = 'info') =>
    log(level, message, { ...context, audit: true }, true),
}

/** Let a long-running process (the worker, on shutdown) drain anything still in flight. */
export const flushLogs = async (): Promise<void> => {
  await Promise.allSettled([...pending, logtail?.flush() ?? Promise.resolve(), auditLogtail?.flush() ?? Promise.resolve()])
}

export {
  getCorrelationId,
  runWithCorrelationId,
  correlationIdFromHeaders,
  CORRELATION_ID_HEADER,
} from './correlation'
