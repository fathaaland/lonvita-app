import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { notDeleted } from '@/collections/shared/softDelete'
import { organizesSomewhere, toVolunteerCards } from '@/lib/volunteers/pool'

type Body = {
  userId?: number
  isVolunteer?: boolean
}

/**
 * The volunteer pool — one for the whole platform (a volunteer isn't tied to an obec), listed for
 * everyone who organizes anywhere: each volunteer with where they help (the volunteer map), their
 * average rating from organizers, and their contact only on the channels they allowed. The volunteer
 * fields on Profiles can't be read over REST by anyone but the volunteer (see
 * `canReadVolunteerFields`), so this endpoint is how the dashboards see the pool.
 */
export async function GET(request: Request) {
  const payload = await getPayload({ config })
  const { user: actor } = await payload.auth({ headers: request.headers })
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await organizesSomewhere(payload, actor))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const profiles = await payload.find({
    collection: 'profiles',
    where: { and: [{ isVolunteer: { equals: true } }, notDeleted] },
    sort: '-volunteerSince',
    pagination: false,
    depth: 1,
    overrideAccess: true,
  })

  return NextResponse.json({ docs: await toVolunteerCards(payload, profiles.docs, actor) })
}

/**
 * Takes someone off the pool — a platform admin anyone, an obec admin people who help in their obec
 * (misuse, someone who asked by phone). Nobody is put into the pool but by themselves: joining is
 * the volunteer's own consent, so this endpoint only ever removes.
 */
export async function POST(request: Request) {
  const payload = await getPayload({ config })
  const { user: actor } = await payload.auth({ headers: request.headers })
  if (!actor) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json()) as Body
  const userId = body.userId ? Number(body.userId) : null
  if (!userId) {
    return NextResponse.json({ error: 'Chybí uživatel.' }, { status: 400 })
  }
  if (body.isVolunteer !== false) {
    return NextResponse.json({ error: 'Do poolu se dobrovolník přihlašuje sám.' }, { status: 400 })
  }

  const profile = (
    await payload.find({
      collection: 'profiles',
      where: { user: { equals: userId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
  ).docs[0]
  if (!profile) {
    return NextResponse.json({ error: 'Profil nebyl nalezen.' }, { status: 404 })
  }

  // An obec's admin takes off people who help in their obec.
  if (actor.role !== 'admin') {
    const place = profile.volunteerMunicipality
    const municipalityId = typeof place === 'object' ? place?.id : place
    const administeredIds = await getAdministeredMunicipalityIds(payload, actor.id)
    if (municipalityId == null || !administeredIds.includes(String(municipalityId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const updated = await payload.update({
    collection: 'profiles',
    id: profile.id,
    data: { isVolunteer: false },
    overrideAccess: true,
  })

  return NextResponse.json({ id: updated.id })
}
