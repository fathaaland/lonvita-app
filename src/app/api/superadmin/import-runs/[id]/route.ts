import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { logger, serializeError } from '@/lib/logger'

const REVIEW_STATUSES = ['ok', 'problem'] as const
const NOTE_MAX_LENGTH = 500

/**
 * The platform's check of a scraping run (Balíčky služeb: "Log běhů scrapingu … stav kontroly") —
 * looked at and fine, or a problem, with a note. ImportRuns is written by the worker alone, so the
 * check goes through here. `reviewStatus: null` clears it.
 *
 * PATCH /api/superadmin/import-runs/:id  { reviewStatus: 'ok' | 'problem' | null, reviewNote?: string }
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user || user.role !== 'admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const runId = Number(id)
  if (!Number.isInteger(runId) || runId <= 0)
    return NextResponse.json({ error: 'Neplatný běh.' }, { status: 400 })

  const body = (await request.json().catch(() => ({}))) as {
    reviewStatus?: unknown
    reviewNote?: unknown
  }
  const status = body.reviewStatus
  if (status !== null && !REVIEW_STATUSES.includes(status as (typeof REVIEW_STATUSES)[number])) {
    return NextResponse.json({ error: 'Neplatný stav kontroly.' }, { status: 400 })
  }
  const note =
    typeof body.reviewNote === 'string' ? body.reviewNote.trim().slice(0, NOTE_MAX_LENGTH) : ''

  try {
    await payload.update({
      collection: 'import-runs',
      id: runId,
      data: {
        reviewStatus: status as (typeof REVIEW_STATUSES)[number] | null,
        reviewNote: note || null,
        reviewedBy: status === null ? null : Number(user.id),
        reviewedAt: status === null ? null : new Date().toISOString(),
      },
      overrideAccess: true,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error('Import run review failed', {
      event: 'import.run_review_failed',
      runId,
      ...serializeError(error),
    })
    return NextResponse.json({ error: 'Kontrolu se nepodařilo uložit.' }, { status: 500 })
  }
}
