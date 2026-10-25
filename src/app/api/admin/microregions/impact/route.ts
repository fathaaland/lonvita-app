import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { brokenPairs, jointEventsAcross } from '@/collections/Microregions'
import { relationId } from '@/lib/relations'

/**
 * What saving (or deleting) a mikroregion would touch — the upcoming events co-organized across obce
 * that would stop sharing a region. They run on to their end; the platform admin sees them before
 * confirming. Platform admins only.
 *
 * GET /api/admin/microregions/impact?regionId=1&municipalityIds=2,3 → { events: { id, title }[] }
 * (no municipalityIds = the region deleted)
 */
export async function GET(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (user?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const params = new URL(request.url).searchParams
  const regionId = params.get('regionId')
  if (!regionId) return NextResponse.json({ events: [] })
  const region = await payload
    .findByID({ collection: 'microregions', id: regionId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!region) return NextResponse.json({ events: [] })

  const before = (region.municipalities ?? [])
    .map(relationId)
    .filter((id): id is string => id !== null)
  const after = (params.get('municipalityIds') ?? '').split(',').filter(Boolean)
  const joint = await jointEventsAcross(payload, brokenPairs(before, after))
  const events = [...new Map(joint.map((e) => [e.id, { id: e.id, title: e.title }])).values()]
  return NextResponse.json({ events })
}
