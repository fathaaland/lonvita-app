import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { canAccessMunicipality } from '@/lib/exports/access'
import { logger, serializeError } from '@/lib/logger'
import { getMunicipalityServices, withoutPrices } from '@/lib/services/municipality-services'

/**
 * The obec's packages and how much of them it used (lib/services) — for its admins without the
 * prices, for a platform admin with them.
 *
 * GET /api/municipalities/:id/services
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessMunicipality(payload, user, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const services = await getMunicipalityServices(payload, Number(id), new Date())
    return NextResponse.json(user.role === 'admin' ? services : withoutPrices(services))
  } catch (error) {
    logger.error('Municipality services failed', {
      event: 'municipality.services_failed',
      municipalityId: id,
      ...serializeError(error),
    })
    return NextResponse.json({ error: 'Služby obce se nepodařilo načíst.' }, { status: 500 })
  }
}
