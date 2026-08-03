import { logger } from '@/lib/logger'

/** Cheap defensive check for a known prototype-pollution attack shape. */
export const warnIfArrayPrototypeIsPolluted = (workerName: string): void => {
  const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'random')

  if (!descriptor?.enumerable) {
    return
  }

  logger.warn('[Worker] Detected enumerable Array.prototype.random', {
    worker: workerName,
    property: 'Array.prototype.random',
    enumerable: descriptor.enumerable,
    configurable: descriptor.configurable,
    writable: descriptor.writable,
  })
}
