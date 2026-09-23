import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { notDeleted } from '@/collections/shared/softDelete'

const ORGANIZING_ROLES = ['municipality_admin', 'organizer'] as const

/**
 * Which organizations can be picked as a spolupořadatel of an event in this obec — its
 * organizers' organizations (the café, the club, a single person's "Vycházky pro seniory"), matched
 * by name. Never the obec itself, and never the searcher's own. An organization whose owner has
 * since lost the organizer role isn't offered. Only someone who organizes in the obec (or a
 * platform admin) may search it. Mirrors Events `resolveOrganizations`.
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
  if (organizerIds.length === 0) return NextResponse.json({ docs: [] })

  const organizations = await payload.find({
    collection: 'organizations',
    where: {
      and: [
        { municipality: { equals: municipalityId } },
        { owner: { in: organizerIds } },
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
      owner_id: String(typeof o.owner === 'object' ? o.owner.id : o.owner),
    })),
  })
}
