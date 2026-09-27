import { escapeHtml, sendNotification } from '@/collections/shared/notify'
import { EXPORT_KIND_LABELS, EXPORT_RETENTION_DAYS } from '@/lib/exports/contracts'
import { logger } from '@/lib/logger'

import { getWorkerPayload } from '../runtime/payload'

import type { ExportReadyJobData, ExportReadyJobResult } from '@/lib/queue/contracts'

const relId = (value: unknown): number | string =>
  typeof value === 'object' && value !== null ? (value as { id: number }).id : (value as number)

/**
 * The fallback half of "dialog polls, notification if you left": runs a minute after the export
 * finished and tells the owner it's ready — unless they already downloaded it from the dialog.
 */
export const processExportReadyJob = async (data: ExportReadyJobData): Promise<ExportReadyJobResult> => {
  const payload = await getWorkerPayload()

  const skip = (reason: string): ExportReadyJobResult => {
    logger.info('Export ready notification skipped', { event: 'export.ready_skipped', exportId: data.exportId, reason })
    return { notified: false, skipped: reason }
  }

  const record = await payload
    .findByID({ collection: 'exports', id: data.exportId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!record) return skip('export_missing')
  if (record.status !== 'done') return skip('not_done')
  if (record.downloadedAt) return skip('already_downloaded')

  const label = `${EXPORT_KIND_LABELS[record.kind]} (${record.format.toUpperCase()})`
  const link = `/api/exports/${record.id}/download`
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  await sendNotification(payload, {
    userId: relId(record.owner),
    title: 'Report je připraven',
    message: `${label} je připraven ke stažení. Odkaz platí ${EXPORT_RETENTION_DAYS} dní.`,
    link,
    email: {
      subject: `Report je připraven — ${EXPORT_KIND_LABELS[record.kind]}`,
      body:
        `<p>Váš export <strong>${escapeHtml(label)}</strong> je připraven ke stažení.</p>` +
        (appUrl ? `<p><a href="${appUrl}${link}">Stáhnout soubor</a></p>` : '') +
        `<p style="color:#666;font-size:13px;">Odkaz platí ${EXPORT_RETENTION_DAYS} dní, pak soubor smažeme — vygenerovat ho můžete kdykoli znovu.</p>`,
    },
  })

  logger.info('Export ready notification sent', { event: 'export.ready_notified', exportId: record.id })
  return { notified: true }
}
