import { EXPORT_FILES_DELETED } from '@/collections/Exports'
import { deleteExportFiles, ExportFilesNotDeletedError } from '@/lib/exports/storage'
import { logger, serializeError } from '@/lib/logger'

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

    // A file S3 kept keeps its row too — it's tried again the next night instead of being left in the
    // bucket with nothing pointing at it.
    let kept = new Set<string>()
    try {
      await deleteExportFiles(expired.docs.map((doc) => doc.fileKey).filter((key): key is string => Boolean(key)))
    } catch (error) {
      if (!(error instanceof ExportFilesNotDeletedError)) throw error
      kept = new Set(error.keys)
      logger.error('Expired export files not deleted', { event: 'export.cleanup_files_kept', kept: kept.size, ...serializeError(error) })
    }
    const gone = expired.docs.filter((doc) => !doc.fileKey || !kept.has(doc.fileKey))
    if (gone.length === 0) return 0
    await payload.delete({
      collection: 'exports',
      where: { id: { in: gone.map((doc) => doc.id) } },
      overrideAccess: true,
      context: { [EXPORT_FILES_DELETED]: true },
    })
    // Rows kept stay first in line — stop here rather than read them again batch after batch.
    return kept.size > 0 ? 0 : expired.docs.length
  })

  logger.info('Export cleanup finished', { event: 'export.cleanup_finished', deleted })
  return { deleted }
}
