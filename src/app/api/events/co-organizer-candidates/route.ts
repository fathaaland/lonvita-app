import { NextResponse } from 'next/server'
import { getPayload, type Where } from 'payload'

import config from '@payload-config'
import { notDeleted } from '@/collections/shared/softDelete'
import { MUNICIPALITY_ORGANIZATION_TYPE } from '@/lib/organizations'

const ORGANIZING_ROLES = ['municipality_admin', 'organizer'] as const

/**
 * Which organizations can be invited to co-organize an event in this obec — the obec's own one
 * first, then its organizers' organizations (the café, the club, a single person's "Vycházky pro
 * seniory") by name, never the requester's own — each with its own photo/logo, set on its
 * "Organizace" page. Each joins only once it accepts (CoOrganizingRequests). An organization
 * whose owner has since lost the organizer role isn't offered. Only someone who organizes in the obec
 * (or a platform admin) may list it. Mirrors CoOrganizingRequests `prepareRequest`.
 *
 * GET /api/events/co-organizer-candidates?municipalityId=1
 */
export async function GET(request: Request) {
  const payload = await getPayload({ config })
  const { user: actor } = await payload.auth({ headers: request.headers })
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const municipalityId = Number(new URL(request.url).searchParams.get('municipalityId'))
  if (!municipalityId) {
    return NextResponse.json({ error: 'Chybí obec.' }, { status: 400 })
  }

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

  const offered: Where[] = [{ type: { equals: MUNICIPALITY_ORGANIZATION_TYPE } }]
  if (organizerIds.length > 0) offered.push({ owner: { in: organizerIds } })

  const organizations = await payload.find({
    collection: 'organizations',
    where: { and: [{ municipality: { equals: municipalityId } }, { or: offered }, notDeleted] },
    sort: 'name',
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })

  const docs = organizations.docs.map((o) => ({
    id: String(o.id),
    name: o.name,
    type: o.type,
    owner_id: o.owner ? String(typeof o.owner === 'object' ? o.owner.id : o.owner) : null,
    avatar_url: o.avatarUrl ?? null,
  }))
  // The obec first — it's the one every pořadatel can ask, whoever else organizes here.
  docs.sort(
    (a, b) => Number(b.type === MUNICIPALITY_ORGANIZATION_TYPE) - Number(a.type === MUNICIPALITY_ORGANIZATION_TYPE),
  )

  return NextResponse.json({ docs })
}
