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
  // bury the signal in production for no benefit.
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

const minLevelWeight = LEVEL_WEIGHT[resolveMinLevel()]

/**
 * Which deployment a line came from. The web app leaves this at its default; the worker's
 * start script sets LOG_SERVICE=worker, so the stored logs can separate "Vercel" from "Railway"
 * without guessing from the message text.
 */
const service = process.env.LOG_SERVICE?.trim() || 'web'
const environment = process.env.VERCEL_ENV?.trim() || process.env.NODE_ENV || 'development'

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|api[-_]?key|credential/i
const MAX_DEPTH = 4

/**
 * Logs are stored and kept for months, so nothing that could authenticate anybody may travel with
 * them. Keys are matched by name rather than value because that is the part we control: a field
 * called `password` never stores its contents, whatever they are.
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

/** A line worth keeping, as handed to the sink (lib/logger/db-sink) — already redacted. */
export type StoredLogEntry = {
  kind: 'security' | 'system'
  level: LogLevel | 'fatal'
  message: string
  event: string | null
  service: string
  environment: string
  timestamp: string
  fields: LogContext
}

export type LogSink = (entry: StoredLogEntry) => Promise<void>

let sink: LogSink | null = null

/**
 * Where kept lines go — registered once Payload (and so the database) is up, in payload.config
 * onInit. Until then, and in a process that never builds Payload, the console is the only output.
 */
export const setLogSink = (next: LogSink | null): void => {
  sink = next
}

/** Diagnostics a table has no use for: every read and write of every collection (the audit log
 * holds the changes that matter), the audit log's own copy, and lines whose numbers live elsewhere
 * (AI calls on the usage-events ledger). */
const UNSTORED_EVENT =
  /^(crud\.|payload\.(?!unhandled_error)|audit\.entry$|logger\.|import\.ai_call$)/

/**
 * What goes into a table, and which one. Sign-ins and everything else under `auth.`/`security.`
 * (or written through logger.audit) is a security event, whatever its level; the rest is a system
 * log — every warning and error, and the info lines that name an `event` (an e-mail sent, an
 * import finished, a job done). Debug lines and anonymous info lines stay on the console.
 */
const classify = (
  level: LogLevel,
  event: string | null,
  audit: boolean,
): StoredLogEntry['kind'] | null => {
  if (event && UNSTORED_EVENT.test(event)) return null
  if (audit || (event && /^(auth|security)\./.test(event))) return 'security'
  if (level === 'warn' || level === 'error') return 'system'
  if (level === 'info' && event) return 'system'
  return null
}

const pending = new Set<Promise<unknown>>()

type VercelRequestContext = {
  get?: () => { waitUntil?: (promise: Promise<unknown>) => void } | undefined
}

/**
 * A Vercel function instance can be frozen the instant it returns its response, which kills any
 * write still in flight. `waitUntil` keeps the instance alive until the insert finishes. Reached
 * through the platform's well-known symbol rather than @vercel/functions so that this module stays
 * importable by the worker, which has no such context (there the promise is simply tracked for
 * flushLogs on shutdown).
 */
const keepAliveUntilSettled = (promise: Promise<unknown>) => {
  pending.add(promise)
  void promise.finally(() => pending.delete(promise))

  const context = (globalThis as Record<symbol, unknown>)[Symbol.for('@vercel/request-context')] as
    VercelRequestContext | undefined
  context?.get?.()?.waitUntil?.(promise)
}

const store = (entry: StoredLogEntry) => {
  if (!sink) return
  // A log that cannot be written must never break the request that wrote it — nor log itself
  // again, which would loop. The console line already carries the content.
  const write = sink(entry).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'logger.store_failed',
        service,
        env: environment,
        event: entry.event,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  })
  keepAliveUntilSettled(write)
}

const log = (level: LogLevel, message: string, context?: LogContext, audit = false) => {
  // The audit trail isn't diagnostics — LOG_LEVEL never thins it out.
  if (!audit && LEVEL_WEIGHT[level] < minLevelWeight) return

  const timestamp = new Date().toISOString()
  const fields: LogContext = {
    correlationId: (context?.correlationId as string) || getCorrelationId(),
    ...(redact(context) as LogContext),
  }

  consoleMethod[level](
    JSON.stringify({ level, message, timestamp, service, env: environment, ...fields }),
  )

  const event = typeof fields.event === 'string' ? fields.event : null
  // An audit entry the database refused is the one copy left of it — kept, unlike the usual echo.
  const kind =
    event === 'audit.entry' && fields.stored === false ? 'system' : classify(level, event, audit)
  if (!kind) return
  store({
    kind,
    level: fields.severity === 'fatal' ? 'fatal' : level,
    message,
    event,
    service,
    environment,
    timestamp,
    fields,
  })
}

export const logger = {
  debug: (message: string, context?: LogContext) => log('debug', message, context),
  info: (message: string, context?: LogContext) => log('info', message, context),
  warn: (message: string, context?: LogContext) => log('warn', message, context),
  error: (message: string, context?: LogContext) => log('error', message, context),
  /**
   * "The app is broken, not just this request". Kept as its own method because the call sites that
   * deserve it — an unhandled Payload error, a worker that cannot start — should be greppable; it is
   * stored with level `fatal`.
   */
  fatal: (message: string, context?: LogContext) =>
    log('error', `[FATAL] ${message}`, { ...context, severity: 'fatal' }),
  /**
   * Who did what security-relevant from where — sign-ins and sign-outs (failed ones too), password
   * resets, and a copy of every audit-log entry (collections/shared/auditLog). Logged whatever
   * LOG_LEVEL says; stored as a security event (the audit-log copy isn't — the row is the record).
   */
  audit: (message: string, context?: LogContext, level: 'info' | 'warn' = 'info') =>
    log(level, message, { ...context, audit: true }, true),
}

/** Let a long-running process (the worker, on shutdown) drain any write still in flight. */
export const flushLogs = async (): Promise<void> => {
  await Promise.allSettled([...pending])
}

export {
  getCorrelationId,
  runWithCorrelationId,
  correlationIdFromHeaders,
  CORRELATION_ID_HEADER,
} from './correlation'
