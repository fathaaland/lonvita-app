import { EXPORT_FILES_DELETED } from '@/collections/Exports'
import { deleteExportFiles } from '@/lib/exports/storage'
import { logger } from '@/lib/logger'

import { getWorkerPayload } from '../runtime/payload'

import type { CleanupExportsJobResult } from '@/lib/queue/contracts'

/** Bounded batches, like the notification cleanup — and S3's DeleteObjects takes at most 1000 keys. */
const BATCH_SIZE = 500
const MAX_BATCHES = 100

/**
 * Drops exports past their `expiresAt` — the S3 file first, then the row, so a failure in between
 * leaves a row pointing at nothing (the download answers 410 either way) rather than an orphaned
 * file nobody can find any more.
 */
export const processCleanupExportsJob = async (): Promise<CleanupExportsJobResult> => {
  const payload = await getWorkerPayload()
  const now = new Date().toISOString()
  let deleted = 0

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const expired = await payload.find({
      collection: 'exports',
      where: { expiresAt: { less_than: now } },
      depth: 0,
      limit: BATCH_SIZE,
      pagination: false,
      overrideAccess: true,
    })
    if (expired.docs.length === 0) break

    await deleteExportFiles(expired.docs.map((doc) => doc.fileKey).filter((key): key is string => Boolean(key)))
    await payload.delete({
      collection: 'exports',
      where: { id: { in: expired.docs.map((doc) => doc.id) } },
      overrideAccess: true,
      context: { [EXPORT_FILES_DELETED]: true },
    })
    deleted += expired.docs.length
    if (expired.docs.length < BATCH_SIZE) break
  }

  logger.info('Export cleanup finished', { event: 'export.cleanup_finished', deleted })
  return { deleted }
}
