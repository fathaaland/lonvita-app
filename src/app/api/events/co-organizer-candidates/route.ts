import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { notDeleted } from '@/collections/shared/softDelete'

const ORGANIZING_ROLES = ['municipality_admin', 'organizer'] as const

/**
 * Who can be picked as a spolupořadatel of an event in this obec — its pořadatelé and admins
 * (a "municipality_admin" or "organizer" user-role there), matched by name. Everyone else's
 * user-roles aren't readable over REST, hence this endpoint. Only someone who organizes in the
 * obec (or a platform admin) may search it. Mirrors Events `requireCoOrganizerRole`.
 *
 * GET /api/events/co-organizer-candidates?municipalityId=1&q=jan
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
    limit: 1000,
    overrideAccess: true,
  })
  const userIds = [...new Set(roles.docs.map((r) => (typeof r.user === 'object' ? r.user.id : r.user)))]

  if (actor.role !== 'admin' && !userIds.includes(actor.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (userIds.length === 0) return NextResponse.json({ docs: [] })

  const profiles = await payload.find({
    collection: 'profiles',
    where: { and: [{ user: { in: userIds } }, { fullName: { like: query } }, notDeleted] },
    sort: 'fullName',
    depth: 0,
    limit: 10,
    overrideAccess: true,
  })

  return NextResponse.json({
    docs: profiles.docs.map((p) => ({
      id: String(typeof p.user === 'object' ? p.user.id : p.user),
      full_name: p.fullName,
      // Users.access.read keeps other people's e-mails private, so the picker shows names only.
      email: null,
    })),
  })
}
