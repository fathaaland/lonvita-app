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
 *
 * Someone who followed the link in a browser gets a page instead of a bare JSON error: signing in
 * first (and coming back here), or /export-nedostupny saying why the file isn't there.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const isPageVisit = request.headers.get('accept')?.includes('text/html') ?? false
  const fail = (status: number, error: string, reason: string) =>
    isPageVisit
      ? NextResponse.redirect(new URL(`/export-nedostupny?duvod=${reason}`, request.url), 302)
      : NextResponse.json({ error }, { status })

  const { user } = await payload.auth({ headers: request.headers })
  if (!user) {
    if (isPageVisit) {
      const back = encodeURIComponent(`/api/exports/${id}/download`)
      return NextResponse.redirect(new URL(`/auth?redirect=${back}`, request.url), 302)
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const record = await findViewableExport(payload, user, id)
  if (!record) return fail(404, 'Export neexistuje.', 'missing')
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    return fail(410, 'Platnost exportu vypršela, vygenerujte ho znovu.', 'expired')
  }
  if (record.status !== 'done' || !record.fileKey || !record.fileName) {
    return fail(409, 'Export ještě není hotový.', 'pending')
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
