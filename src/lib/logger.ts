type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const consoleMethod: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
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

function shipToBetterStack(level: LogLevel, message: string, context?: Record<string, unknown>) {
  if (!betterStackToken || !betterStackHost) return
  // Fire-and-forget — a logging backend being unreachable must never affect the app itself.
  fetch(`https://${betterStackHost}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${betterStackToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, level, dt: new Date().toISOString(), ...context }),
  }).catch(() => {
    // Deliberately silent — falling back to console (already logged below) is enough; a
    // console.error here about a logging failure would just be more noise to ship nowhere.
  })
}

const log = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
  const entry = { level, message, timestamp: new Date().toISOString(), ...(context ? { context } : {}) }
  consoleMethod[level](JSON.stringify(entry))
  shipToBetterStack(level, message, context)
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => log('error', message, context),
}
