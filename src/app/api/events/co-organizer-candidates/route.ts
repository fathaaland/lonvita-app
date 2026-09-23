import { NextResponse } from 'next/server'
import { getPayload, type Where } from 'payload'

import config from '@payload-config'
import { notDeleted } from '@/collections/shared/softDelete'
import { MUNICIPALITY_ORGANIZATION_TYPE } from '@/lib/organizations'

const ORGANIZING_ROLES = ['municipality_admin', 'organizer'] as const

/**
 * Which organizations can be picked as a spolupořadatel of an event in this obec — its
 * organizers' organizations (the café, the club, a single person's "Vycházky pro seniory"), matched
 * by name, never the searcher's own. The obec itself only for its admins and a platform admin — a
 * pořadatel asks the obec instead (CoOrganizingRequests). An organization whose owner has since
 * lost the organizer role isn't offered. Only someone who organizes in the obec (or a platform
 * admin) may search it. Mirrors Events `resolveOrganizations`.
 *
 * GET /api/events/co-organizer-candidates?municipalityId=1&q=kav
 */
export async function GET(request: Request) {
  const payload = await getPayload({ config })
  const { user: actor } = await payload.auth({ headers: request.headers })
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = new URL(request.url).searchParams
  const municipalityId = Number(params.get('municipalityId'))
  const query = (params.get('q') ?? '').trim()
  if (!municipalityId) {
    return NextResponse.json({ error: 'Chybí obec.' }, { status: 400 })
  }
  if (query.length < 2) return NextResponse.json({ docs: [] })

  const roles = await payload.find({
    collection: 'user-roles',
    where: {
      and: [{ municipality: { equals: municipalityId } }, { role: { in: [...ORGANIZING_ROLES] } }],
    },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const userIdOf = (r: (typeof roles.docs)[number]) => (typeof r.user === 'object' ? r.user.id : r.user)

  if (actor.role !== 'admin' && !roles.docs.some((r) => userIdOf(r) === actor.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const organizerIds = [
    ...new Set(roles.docs.filter((r) => r.role === 'organizer').map(userIdOf)),
  ].filter((id) => id !== actor.id)
  const mayAddObec =
    actor.role === 'admin' ||
    roles.docs.some((r) => r.role === 'municipality_admin' && userIdOf(r) === actor.id)

  const offered: Where[] = []
  if (organizerIds.length > 0) offered.push({ owner: { in: organizerIds } })
  if (mayAddObec) offered.push({ type: { equals: MUNICIPALITY_ORGANIZATION_TYPE } })
  if (offered.length === 0) return NextResponse.json({ docs: [] })

  const organizations = await payload.find({
    collection: 'organizations',
    where: {
      and: [
        { municipality: { equals: municipalityId } },
        { or: offered },
        { name: { like: query } },
        notDeleted,
      ],
    },
    sort: 'name',
    depth: 0,
    limit: 10,
    overrideAccess: true,
  })

  return NextResponse.json({
    docs: organizations.docs.map((o) => ({
      id: String(o.id),
      name: o.name,
      type: o.type,
      owner_id: o.owner ? String(typeof o.owner === 'object' ? o.owner.id : o.owner) : null,
    })),
  })
}
