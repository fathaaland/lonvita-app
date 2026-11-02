import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { billingCsv, billingRowsFor, isMonthKey } from '@/lib/billing/report'
import { pragueMonthKey } from '@/lib/billing/period'
import { logger, serializeError } from '@/lib/logger'

/**
 * Every obec's licence band, packages and use for a month — the superadmin's billing overview, and
 * with `format=csv` its export (Balíčky služeb: "měsíční CSV po obcích"). Platform admins only.
 *
 * GET /api/superadmin/billing?month=2026-11[&format=csv]
 */
export async function GET(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user || user.role !== 'admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(request.url)
  const now = new Date()
  const requested = url.searchParams.get('month')
  if (requested !== null && !isMonthKey(requested)) {
    return NextResponse.json({ error: 'Měsíc musí být ve tvaru RRRR-MM.' }, { status: 400 })
  }
  const month = requested ?? pragueMonthKey(now)

  try {
    const rows = await billingRowsFor(payload, month, now)
    if (url.searchParams.get('format') === 'csv') {
      return new NextResponse(billingCsv(rows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="lonvita-obce-${month}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    return NextResponse.json({ month, rows })
  } catch (error) {
    logger.error('Billing overview failed', {
      event: 'billing.overview_failed',
      month,
      ...serializeError(error),
    })
    return NextResponse.json({ error: 'Přehled se nepodařilo načíst.' }, { status: 500 })
  }
}
