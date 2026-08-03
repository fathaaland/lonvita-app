import { logger } from '@/lib/logger'

import type { QueueWorker } from './spawn-worker'

export const registerShutdown = (label: string, workers: QueueWorker[]): void => {
  const shutdown = async () => {
    logger.info(`[${label}] Shutting down gracefully...`)
    await Promise.all(workers.map((worker) => worker.close()))
    logger.info(`[${label}] All workers stopped`)
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
