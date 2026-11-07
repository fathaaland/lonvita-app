import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { eventAreaMapOfRegion } from '@/lib/events/area'
import { logger, serializeError } from '@/lib/logger'

/**
 * Where the published, coming events of a mikroregion's obce take place, against their contractual
 * radii — the superadmin's map of the region (lib/events/area).
 *
 * GET /api/superadmin/microregions/:id/event-map
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const regionId = Number(id)
  if (!Number.isInteger(regionId) || regionId <= 0) {
    return NextResponse.json({ error: 'Neplatný mikroregion.' }, { status: 400 })
  }

  try {
    return NextResponse.json(await eventAreaMapOfRegion(payload, regionId))
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      return NextResponse.json({ error: 'Mikroregion neexistuje.' }, { status: 404 })
    }
    logger.error('Event area map failed', { event: 'events.region_area_map_failed', regionId, ...serializeError(error) })
    return NextResponse.json({ error: 'Mapu akcí se nepodařilo načíst.' }, { status: 500 })
  }
}
