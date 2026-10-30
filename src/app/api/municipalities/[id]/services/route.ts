import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { canAccessMunicipality } from '@/lib/exports/access'
import { logger, serializeError } from '@/lib/logger'
import { getMunicipalityServices, withoutCosts } from '@/lib/services/municipality-services'

/**
 * What the obec pays for and what it has used of it this month (lib/services) — for its admins, and
 * for a platform admin with what the AI actually cost us on top.
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
    return NextResponse.json(user.role === 'admin' ? services : withoutCosts(services))
  } catch (error) {
    logger.error('Municipality services failed', {
      event: 'municipality.services_failed',
      municipalityId: id,
      ...serializeError(error),
    })
    return NextResponse.json({ error: 'Služby obce se nepodařilo načíst.' }, { status: 500 })
  }
}
