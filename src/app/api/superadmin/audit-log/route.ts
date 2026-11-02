import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { auditCsv, parseAuditFilters, queryAuditLog } from '@/lib/compliance/audit-query'
import { logger, serializeError } from '@/lib/logger'

/** The CSV takes at most this many entries — a narrower filter for more. */
const CSV_MAX_ROWS = 10_000

/**
 * The audit log for the platform's admins — filtered (action, who, obec, target, outcome, days),
 * a page at a time, or with `format=csv` the whole filtered set. Every read is itself recorded in
 * the audit log (vyhláška 409/2025 Sb. § 22).
 *
 * GET /api/superadmin/audit-log?action=&actor=&municipality=&target=&outcome=&from=&to=&page=[&format=csv]
 */
export async function GET(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user || user.role !== 'admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const params = new URL(request.url).searchParams
  const filters = parseAuditFilters(params)
  const csv = params.get('format') === 'csv'
  const page = Math.max(1, Number(params.get('page')) || 1)

  try {
    const result = await queryAuditLog(
      payload,
      user,
      filters,
      csv ? { page: 1, limit: CSV_MAX_ROWS } : { page, limit: 50 },
    )
    if (csv) {
      const day = new Date().toISOString().slice(0, 10)
      return new NextResponse(auditCsv(result.rows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="lonvita-audit-log-${day}.csv"`,
          'Cache-Control': 'no-store',
          'X-Total-Count': String(result.totalDocs),
        },
      })
    }
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    logger.error('Audit log query failed', {
      event: 'audit.query_failed',
      ...serializeError(error),
    })
    return NextResponse.json({ error: 'Audit log se nepodařilo načíst.' }, { status: 500 })
  }
}
