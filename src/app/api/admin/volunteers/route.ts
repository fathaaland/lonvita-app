import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'

type Body = {
  userId?: number
  municipalityId?: number
  isVolunteer?: boolean
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
