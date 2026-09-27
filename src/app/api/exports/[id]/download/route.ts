import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { findViewableExport } from '@/lib/exports/access'
import { presignExportDownload } from '@/lib/exports/storage'
import { logger } from '@/lib/logger'

/**
 * Hands out a finished export: checks the owner, then redirects to a presigned S3 URL that lives
 * for a few minutes. The link itself stays valid for the whole retention period, so it's what the
 * "report je připraven" notification and e-mail point at. A plain GET so the browser can simply
 * navigate to it — the session cookie authenticates it.
 *
 * GET /api/exports/:id/download → 302 to S3
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const record = await findViewableExport(payload, user, id)
  if (!record) return NextResponse.json({ error: 'Export neexistuje.' }, { status: 404 })
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Platnost exportu vypršela, vygenerujte ho znovu.' }, { status: 410 })
  }
  if (record.status !== 'done' || !record.fileKey || !record.fileName) {
    return NextResponse.json({ error: 'Export ještě není hotový.' }, { status: 409 })
  }

  // Only the owner's download counts — it's what tells the export-ready job to stay quiet.
  if (!record.downloadedAt && String(user.id) === String(typeof record.owner === 'object' ? record.owner.id : record.owner)) {
    await payload.update({
      collection: 'exports',
      id: record.id,
      data: { downloadedAt: new Date().toISOString() },
      overrideAccess: true,
    })
  }

  logger.info('Export downloaded', { event: 'export.downloaded', exportId: record.id, userId: user.id })
  return NextResponse.redirect(await presignExportDownload(record.fileKey, record.fileName), 302)
}
