import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { eventAreaMapOf } from '@/lib/events/area'
import { logger, serializeError } from '@/lib/logger'

/**
 * Where an obec's published, coming events take place, against its contractual radius — the
 * superadmin's map on the obec's page (lib/events/area).
 *
 * GET /api/superadmin/municipalities/:id/event-map
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const municipalityId = Number(id)
  if (!Number.isInteger(municipalityId) || municipalityId <= 0) {
    return NextResponse.json({ error: 'Neplatná obec.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await eventAreaMapOf(payload, municipalityId))
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      return NextResponse.json({ error: 'Obec neexistuje.' }, { status: 404 })
    }
    logger.error('Event area map failed', { event: 'events.area_map_failed', municipalityId, ...serializeError(error) })
    return NextResponse.json({ error: 'Mapu akcí se nepodařilo načíst.' }, { status: 500 })
  }
}
