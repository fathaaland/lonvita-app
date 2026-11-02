import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { billingDetailOf } from '@/lib/billing/report'
import { logger, serializeError } from '@/lib/logger'

/**
 * One obec's packages for the superadmin (Balíčky služeb: "Co má umět superadmin") — the settings,
 * what it used, its monthly user snapshots, its sources, the scraping run log and who changed what.
 *
 * GET /api/superadmin/billing/:id
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user || user.role !== 'admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const municipalityId = Number(id)
  if (!Number.isInteger(municipalityId) || municipalityId <= 0) {
    return NextResponse.json({ error: 'Neplatná obec.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await billingDetailOf(payload, municipalityId, new Date()))
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      return NextResponse.json({ error: 'Obec neexistuje.' }, { status: 404 })
    }
    logger.error('Billing detail failed', {
      event: 'billing.detail_failed',
      municipalityId,
      ...serializeError(error),
    })
    return NextResponse.json({ error: 'Obec se nepodařilo načíst.' }, { status: 500 })
  }
}
