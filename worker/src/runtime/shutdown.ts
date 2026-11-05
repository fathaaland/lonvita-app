import { flushLogs, logger, serializeError } from '@/lib/logger'

import type { QueueWorker } from './spawn-worker'

/** What the running jobs get to finish before the process goes anyway — under the platform's own
 * grace period (Railway: RAILWAY_DEPLOYMENT_DRAINING_SECONDS, set it to 30 or more), so the exit is
 * ours. A job cut off here stalls and is picked up again by the next worker. */
const SHUTDOWN_TIMEOUT_MS = 25_000

export const registerShutdown = (
  label: string,
  workers: QueueWorker[],
  { beforeClose }: { beforeClose?: () => Promise<void> } = {},
): void => {
  let shuttingDown = false

  const shutdown = async (reason: string, exitCode = 0) => {
    // A second signal (or a crash during shutdown) must not start it all over again.
    if (shuttingDown) return
    shuttingDown = true
    logger.info('Shutting down gracefully', { event: 'worker.shutdown_started', worker: label, reason })

    const forced = setTimeout(() => {
      logger.error('Shutdown timed out — exiting with jobs still running', { event: 'worker.shutdown_timed_out', worker: label })
      void flushLogs().finally(() => process.exit(exitCode || 1))
    }, SHUTDOWN_TIMEOUT_MS)
    forced.unref()

    try {
      await beforeClose?.()
      await Promise.all(workers.map((worker) => worker.close()))
      logger.info('All workers stopped', { event: 'worker.shutdown_completed', worker: label })
    } catch (error) {
      logger.error('Shutdown failed', { event: 'worker.shutdown_failed', worker: label, ...serializeError(error) })
      exitCode ||= 1
    }
    // Shipping is fire-and-forget, so without this the last few lines — the ones explaining
    // why the process is going down — die with the process.
    await flushLogs()
    process.exit(exitCode)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  // A crash nobody caught leaves the process in a state nobody knows — logged, then restarted by the
  // platform (restartPolicyType ALWAYS), rather than running on half-broken.
  process.on('uncaughtException', (error) => {
    logger.fatal('Worker crashed', { event: 'worker.uncaught_exception', ...serializeError(error) })
    void shutdown('uncaughtException', 1)
  })
  process.on('unhandledRejection', (reason) => {
    logger.fatal('Worker crashed', { event: 'worker.unhandled_rejection', ...serializeError(reason) })
    void shutdown('unhandledRejection', 1)
  })
}
