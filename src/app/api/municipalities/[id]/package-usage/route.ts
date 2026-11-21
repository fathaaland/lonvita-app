import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { canAccessMunicipality } from '@/lib/exports/access'
import { logger, serializeError } from '@/lib/logger'
import { getPackageUsage } from '@/lib/services/package-usage'

/**
 * Who of the obec used how much of its packages this licence year — the obec itself and each
 * organizer's organization: SMS, AI reads of the event import, sources switched on (lib/services
 * package-usage). For the obec's admins and the platform's; nobody else sees another's use.
 *
 * GET /api/municipalities/:id/package-usage
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!/^\d+$/.test(id) || !(await canAccessMunicipality(payload, user, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    return NextResponse.json(await getPackageUsage(payload, Number(id), new Date()))
  } catch (error) {
    logger.error('Package usage failed', {
      event: 'municipality.package_usage_failed',
      municipalityId: id,
      ...serializeError(error),
    })
    return NextResponse.json({ error: 'Čerpání balíčku se nepodařilo načíst.' }, { status: 500 })
  }
}
