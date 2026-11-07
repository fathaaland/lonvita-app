import * as Sentry from '@sentry/node'

/**
 * Sentry for the worker — what fails here (an e-mail that used up its tries, a crashed process, a
 * scheduled job that stopped running) never reaches the app's Sentry otherwise. The same project as
 * the app: SENTRY_DSN, or NEXT_PUBLIC_SENTRY_DSN when the service shares the app's variables. Without
 * either it stays off (local runs, tests).
 *
 * No `sendDefaultPii`, no local variables, no job data on the events: jobs carry e-mail addresses,
 * phone numbers and message texts — only ids, types and the error leave for Sentry.
 */
const dsn = process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined

export const sentryEnabled = Boolean(dsn)

Sentry.init({
  dsn,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV,
  release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
  serverName: 'lonvita-worker',
  initialScope: { tags: { service: 'worker' } },
})

/** What is still on its way to Sentry — before the process exits (runtime/shutdown). */
export const flushSentry = async (timeoutMs = 2_000): Promise<void> => {
  if (!sentryEnabled) return
  await Sentry.flush(timeoutMs).catch(() => undefined)
}

export { Sentry }
