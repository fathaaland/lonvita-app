import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { eventOrganizerIds } from '@/collections/Events'
import { loadReliability } from '@/collections/shared/reliability'

const relId = (value: unknown) => String(value && typeof value === 'object' ? (value as { id: unknown }).id : value)

/**
 * How reliably each participant signed up for the event turns up (lib/reliability) — the badge next
 * to their registration on the Spravovat page. Only for whoever runs the event: its pořadatel, every
 * spolupořadatel, an admin of its obec and a platform admin — the same people who decide about the
 * registrations. Numbers only; never which events, nor where.
 *
 * GET /api/events/:id/reliability → { [userId]: { attended, excused, noShows, restrictedUntil } }
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const event = await payload.findByID({ collection: 'events', id, depth: 0, overrideAccess: true }).catch(() => null)
  if (!event || event.deletedAt) return NextResponse.json({ error: 'Akce neexistuje.' }, { status: 404 })

  const runsIt =
    user.role === 'admin' ||
    eventOrganizerIds(event).includes(String(user.id)) ||
    (await getAdministeredMunicipalityIds(payload, user.id)).includes(relId(event.municipality))
  if (!runsIt) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const registrations = await payload.find({
    collection: 'registrations',
    where: {
      and: [{ event: { equals: event.id } }, { role: { not_equals: 'volunteer' } }, { deletedAt: { exists: false } }],
    },
    select: { user: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const records = await loadReliability(
    payload,
    registrations.docs.map((r) => relId(r.user)),
  )
  return NextResponse.json(Object.fromEntries(records))
}
