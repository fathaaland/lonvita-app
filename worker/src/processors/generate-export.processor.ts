import { UnrecoverableError } from 'bullmq'

import { buildExport } from '@/lib/exports/build'
import { exportRequestSchema } from '@/lib/exports/contracts'
import { exportFileKey, uploadExportFile } from '@/lib/exports/storage'
import { logger, serializeError } from '@/lib/logger'
import { enqueueExportReady } from '@/lib/queue/queues'
import { queueOptions } from '@/lib/queue/options'

import { getWorkerPayload } from '../runtime/payload'

import type { GenerateExportJobData, GenerateExportJobResult } from '@/lib/queue/contracts'

/** Long enough for the dialog's polling to have picked the file up — only an owner who closed
 * it before then gets the "report je připraven" notification. */
export const EXPORT_READY_DELAY_MS = 60 * 1000

const MAX_ERROR_LENGTH = 500

const relId = (value: unknown): string =>
  String(typeof value === 'object' && value !== null ? (value as { id: number }).id : value)

/**
 * Renders the file an `exports` row describes, uploads it to S3 and marks the row done. The row
 * only turns `failed` once the last attempt fails — a passing S3 hiccup is retried by BullMQ
 * without the dialog ever showing an error.
 */
export const processGenerateExportJob = async (
  data: GenerateExportJobData,
  context: { jobId?: string; attemptsMade?: number },
): Promise<GenerateExportJobResult> => {
  const payload = await getWorkerPayload()
  const startedAt = Date.now()

  const skip = (reason: string): GenerateExportJobResult => {
    logger.info('Export skipped', { event: 'export.skipped', exportId: data.exportId, reason })
    return { generated: false, skipped: reason }
  }

  const record = await payload
    .findByID({ collection: 'exports', id: data.exportId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!record) return skip('export_missing')
  if (record.status === 'done') return skip('already_done')

  const markFailed = (error: unknown) =>
    payload.update({
      collection: 'exports',
      id: record.id,
      data: { status: 'failed', error: (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH) },
      overrideAccess: true,
    })

  const request = exportRequestSchema.safeParse({ kind: record.kind, format: record.format, params: record.params })
  if (!request.success) {
    // Retrying can't fix a row that was stored wrong — fail it now instead of three times.
    await markFailed(request.error)
    throw new UnrecoverableError(`Invalid export parameters: ${request.error.message}`)
  }

  await payload.update({
    collection: 'exports',
    id: record.id,
    data: { status: 'processing', error: null },
    overrideAccess: true,
  })
  logger.info('Export started', {
    event: 'export.started',
    exportId: record.id,
    kind: record.kind,
    format: record.format,
    attempt: (context.attemptsMade ?? 0) + 1,
  })

  try {
    const built = await buildExport(payload, request.data, relId(record.owner))
    const fileKey = exportFileKey(record.id, built.fileName)
    await uploadExportFile(fileKey, built.body, built.contentType)

    await payload.update({
      collection: 'exports',
      id: record.id,
      data: { status: 'done', fileKey, fileName: built.fileName },
      overrideAccess: true,
    })
    await enqueueExportReady(
      { exportId: record.id },
      { jobId: `export-ready-${record.id}`, delay: EXPORT_READY_DELAY_MS },
    )

    logger.info('Export completed', {
      event: 'export.completed',
      exportId: record.id,
      kind: record.kind,
      format: record.format,
      bytes: built.body.length,
      durationMs: Date.now() - startedAt,
    })
    return { generated: true, bytes: built.body.length }
  } catch (error) {
    const attempts = queueOptions.defaultJobOptions.attempts
    const finalAttempt = (context.attemptsMade ?? 0) + 1 >= attempts
    if (finalAttempt) await markFailed(error).catch(() => undefined)

    logger.error('Export failed', {
      event: 'export.failed',
      exportId: record.id,
      kind: record.kind,
      format: record.format,
      finalAttempt,
      durationMs: Date.now() - startedAt,
      ...serializeError(error),
    })
    throw error
  }
}
