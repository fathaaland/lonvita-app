type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const consoleMethod: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
}

const log = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
  const entry = { level, message, timestamp: new Date().toISOString(), ...(context ? { context } : {}) }
  consoleMethod[level](JSON.stringify(entry))
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => log('error', message, context),
}
