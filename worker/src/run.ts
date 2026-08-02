import 'dotenv/config'

import { logger } from '@/lib/logger'

import { warnIfArrayPrototypeIsPolluted } from './runtime/prototype-safety'
import { registerShutdown } from './runtime/shutdown'
import { spawnQueueWorker } from './runtime/spawn-worker'

logger.info('[Worker] Starting worker...')
warnIfArrayPrototypeIsPolluted('lonvita-worker')

const worker = spawnQueueWorker()

registerShutdown('Worker', [worker])
