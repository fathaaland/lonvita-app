import { createServer, type Server } from 'node:http'

import { HEARTBEAT_INTERVAL_MS, writeWorkerHeartbeat } from '@/lib/health/heartbeat'
import { logger, serializeError } from '@/lib/logger'

import type { QueueWorker } from './spawn-worker'

/**
 * Two ways of telling the outside the worker is alive:
 *  - a heartbeat in Redis every HEARTBEAT_INTERVAL_MS, which the app's /api/health reads — the
 *    worker has no public address, so that is what an uptime monitor ends up watching;
 *  - GET /health on $PORT for the platform's own deploy check (railway.json healthcheckPath): 200
 *    while every queue worker is running, 503 otherwise.
 * Returns a stop function for the shutdown.
 */
export function startHealthReporting(workers: QueueWorker[]): () => Promise<void> {
  const beat = () =>
    writeWorkerHeartbeat().catch((error) =>
      logger.warn('Worker heartbeat not written', { event: 'worker.heartbeat_failed', ...serializeError(error) }),
    )
  void beat()
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS)
  timer.unref()

  let server: Server | undefined
  // Railway's healthcheck calls $PORT; 8080 when it isn't set (set PORT=8080 on the service then).
  const port = Number(process.env.PORT) || 8080
  {
    server = createServer((request, response) => {
      if (request.url !== '/health') {
        response.writeHead(404).end()
        return
      }
      const running = workers.every((worker) => worker.isRunning())
      response
        .writeHead(running ? 200 : 503, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ status: running ? 'ok' : 'stopped' }))
    })
    server.on('error', (error) =>
      logger.error('Worker health endpoint not listening', { event: 'worker.health_listen_failed', port, ...serializeError(error) }),
    )
    server.listen(port, () => logger.info('Worker health endpoint listening', { event: 'worker.health_listening', port }))
  }

  return async () => {
    clearInterval(timer)
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  }
}
