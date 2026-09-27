import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { canRequestExport } from '@/lib/exports/access'
import { EXPORT_RETENTION_DAYS, exportRequestSchema } from '@/lib/exports/contracts'
import { logger, serializeError } from '@/lib/logger'
import { correlationIdFromHeaders } from '@/lib/logger/correlation'
import { enqueueGenerateExport } from '@/lib/queue/queues'
import { consumeRateLimit } from '@/lib/security/rate-limit'

/** One person rarely needs more than a couple of files in flight — the rest just queue behind them. */
const MAX_PENDING_PER_USER = 3
const RATE_LIMIT = { max: 20, windowSeconds: 60 * 60 }

/**
 * Asks the worker for a report file. Answers immediately with the `exports` row id; the client
 * polls GET /api/exports/:id and downloads through /api/exports/:id/download once it's done.
 *
 * POST /api/exports  { kind, format, params } → { id }
 */
export async function POST(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = exportRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Neplatný požadavek na export.' }, { status: 400 })
  const exportRequest = parsed.data

  const access = await canRequestExport(payload, user, exportRequest)
  if (access === 'missing') return NextResponse.json({ error: 'Záznam neexistuje.' }, { status: 404 })
  if (access === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const pending = await payload.count({
    collection: 'exports',
    where: { owner: { equals: user.id }, status: { in: ['queued', 'processing'] } },
    overrideAccess: true,
  })
  if (pending.totalDocs >= MAX_PENDING_PER_USER) {
    return NextResponse.json({ error: 'Počkejte na dokončení předchozích exportů.' }, { status: 429 })
  }

  const limit = await consumeRateLimit({ namespace: 'exports', identifier: String(user.id), ...RATE_LIMIT })
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Příliš mnoho exportů, zkuste to později.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  const record = await payload.create({
    collection: 'exports',
    data: {
      owner: user.id,
      kind: exportRequest.kind,
      format: exportRequest.format,
      params: exportRequest.params,
      status: 'queued',
      expiresAt: new Date(Date.now() + EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    },
    overrideAccess: true,
  })

  try {
    await enqueueGenerateExport(
      { exportId: record.id },
      { jobId: `generate-export-${record.id}`, correlationId: correlationIdFromHeaders(request.headers) },
    )
  } catch (error) {
    // Without the job the row would sit in "queued" forever and the dialog would poll until it gives up.
    await payload
      .update({
        collection: 'exports',
        id: record.id,
        data: { status: 'failed', error: 'Frontu se nepodařilo zastihnout.' },
        overrideAccess: true,
      })
      .catch(() => undefined)
    logger.error('Export enqueue failed', { event: 'export.enqueue_failed', exportId: record.id, ...serializeError(error) })
    return NextResponse.json({ error: 'Export se teď nepodařilo spustit, zkuste to znovu.' }, { status: 503 })
  }

  logger.info('Export requested', {
    event: 'export.requested',
    exportId: record.id,
    userId: user.id,
    kind: exportRequest.kind,
    format: exportRequest.format,
  })
  return NextResponse.json({ id: record.id })
}
