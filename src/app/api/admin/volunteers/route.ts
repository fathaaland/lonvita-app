import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { getAdministeredMunicipalityIds, getOrganizerMunicipalityIds } from '@/collections/access/shared'

type Body = {
  userId?: number
  municipalityId?: number
  isVolunteer?: boolean
}

/** A municipality's volunteer pool, for its admins and organizers (or a platform admin). The
 * volunteer fields on Profiles can't be queried over REST by anyone else (see
 * `canReadVolunteerFields`), so this scoped endpoint is how the dashboards list the pool. */
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

  if (actor.role !== 'admin') {
    const [administeredIds, organizerIds] = await Promise.all([
      getAdministeredMunicipalityIds(payload, actor.id),
      getOrganizerMunicipalityIds(payload, actor.id),
    ])
    if (![...administeredIds, ...organizerIds].includes(String(municipalityId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const profiles = await payload.find({
    collection: 'profiles',
    where: { and: [{ municipality: { equals: municipalityId } }, { isVolunteer: { equals: true } }] },
    sort: '-volunteerSince',
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })

  // E-mails stay as visible as Users.access.read makes them over REST: platform admins only.
  const emailByUserId = new Map<number, string>()
  if (actor.role === 'admin' && profiles.docs.length > 0) {
    const users = await payload.find({
      collection: 'users',
      where: { id: { in: profiles.docs.map((p) => (typeof p.user === 'object' ? p.user.id : p.user)) } },
      limit: profiles.docs.length,
      depth: 0,
      overrideAccess: true,
    })
    for (const u of users.docs) emailByUserId.set(u.id, u.email)
  }

  return NextResponse.json({
    docs: profiles.docs.map((p) => {
      const userId = typeof p.user === 'object' ? p.user.id : p.user
      return {
        id: String(p.id),
        user_id: String(userId),
        full_name: p.fullName,
        phone: p.phone ?? null,
        email: emailByUserId.get(userId) ?? null,
        volunteer_focus: p.volunteerFocus ?? null,
        volunteer_note: p.volunteerNote ?? null,
        volunteer_since: p.volunteerSince ?? null,
      }
    }),
  })
}

/** Lets a municipality admin (or platform admin) add or remove someone from the volunteer pool
 * directly — Profiles.access.update only allows self-edits, so this narrow endpoint is the only
 * way an admin can flip `isVolunteer` on someone else's profile. */
export async function POST(request: Request) {
  const payload = await getPayload({ config })
  const { user: actor } = await payload.auth({ headers: request.headers })
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json()) as Body
  const municipalityId = body.municipalityId ? Number(body.municipalityId) : null
  const userId = body.userId ? Number(body.userId) : null
  const isVolunteer = Boolean(body.isVolunteer)

  if (!municipalityId || !userId) {
    return NextResponse.json({ error: 'Chybí uživatel nebo obec.' }, { status: 400 })
  }

  if (actor.role !== 'admin') {
    const administeredIds = await getAdministeredMunicipalityIds(payload, actor.id)
    if (!administeredIds.includes(String(municipalityId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const profiles = await payload.find({
    collection: 'profiles',
    where: { and: [{ user: { equals: userId } }, { municipality: { equals: municipalityId } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const profile = profiles.docs[0]
  if (!profile) {
    return NextResponse.json({ error: 'Profil nebyl nalezen v této obci.' }, { status: 404 })
  }

  const updated = await payload.update({
    collection: 'profiles',
    id: profile.id,
    data: isVolunteer
      ? { isVolunteer: true, volunteerSince: profile.volunteerSince ?? new Date().toISOString() }
      : { isVolunteer: false },
    overrideAccess: true,
  })

  return NextResponse.json({ id: updated.id })
}
