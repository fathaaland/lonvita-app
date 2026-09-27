import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { findViewableExport } from '@/lib/exports/access'

import type { ExportStatusResponse } from '@/lib/exports/contracts'

/**
 * Where a requested export is at — polled by `useExport` until it settles.
 *
 * GET /api/exports/:id → { id, status, fileName, error }
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const record = await findViewableExport(payload, user, id)
  if (!record) return NextResponse.json({ error: 'Export neexistuje.' }, { status: 404 })

  const body: ExportStatusResponse = {
    id: record.id,
    status: record.status,
    fileName: record.fileName ?? null,
    error: record.error ?? null,
  }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
