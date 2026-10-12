import { EXPORT_FILES_DELETED } from '@/collections/Exports'
import { deleteExportFiles } from '@/lib/exports/storage'
import { logger } from '@/lib/logger'

import { BATCH_SIZE, inBatches } from '../runtime/batches'
import { getWorkerPayload } from '../runtime/payload'

import type { CleanupExportsJobResult } from '@/lib/queue/contracts'

/**
 * Drops exports past their `expiresAt` — the S3 file first, then the row, so a failure in between
 * leaves a row pointing at nothing (the download answers 410 either way) rather than an orphaned
 * file nobody can find any more. In batches (runtime/batches): S3's DeleteObjects takes at most
 * 1000 keys, so BATCH_SIZE has to stay under that.
 */
export const processCleanupExportsJob = async (): Promise<CleanupExportsJobResult> => {
  const payload = await getWorkerPayload()
  const now = new Date().toISOString()
  const deleted = await inBatches(async () => {
    const expired = await payload.find({
      collection: 'exports',
      where: { expiresAt: { less_than: now } },
      depth: 0,
      limit: BATCH_SIZE,
      pagination: false,
      overrideAccess: true,
    })
    if (expired.docs.length === 0) return 0

    await deleteExportFiles(expired.docs.map((doc) => doc.fileKey).filter((key): key is string => Boolean(key)))
    await payload.delete({
      collection: 'exports',
      where: { id: { in: expired.docs.map((doc) => doc.id) } },
      overrideAccess: true,
      context: { [EXPORT_FILES_DELETED]: true },
    })
    return expired.docs.length
  })

  logger.info('Export cleanup finished', { event: 'export.cleanup_finished', deleted })
  return { deleted }
}
