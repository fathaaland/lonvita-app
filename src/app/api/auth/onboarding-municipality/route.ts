import { NextResponse } from 'next/server'
import { getPayload, type Payload } from 'payload'

import config from '@payload-config'

/**
 * Signing up with e-mail picks the obec on the map in the registration form; signing up with
 * Google skips that form, so those accounts pick it in onboarding instead. Auth identities
 * aren't readable by their owner over REST, hence this endpoint.
 *
 * GET  → `{ needed }` — whether onboarding should show the obec step.
 * POST `{ municipality }` → files the profile under it with a "participant" role there, the
 * same as /api/auth/register does. "Bez obce" needs no call — the profile already has none.
 */
async function loadState(payload: Payload, userId: number) {
  const [profiles, identities] = await Promise.all([
    payload.find({
      collection: 'profiles',
      where: { user: { equals: userId } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'auth-identities',
      where: { and: [{ user: { equals: userId } }, { provider: { equals: 'google' } }] },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    }),
  ])
  const profile = profiles.docs[0]
  const pickingAllowed = Boolean(profile) && !profile.onboardingCompleted && identities.docs.length > 0
  return { profile, pickingAllowed, needed: pickingAllowed && !profile.municipality }
}

export async function GET(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { needed } = await loadState(payload, user.id)
  return NextResponse.json({ needed })
}

export async function POST(request: Request) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as { municipality?: string | number }
  const municipalityId = Number(body.municipality)
  if (!municipalityId) {
    return NextResponse.json({ error: 'Chybí obec.' }, { status: 400 })
  }

  const { profile, pickingAllowed } = await loadState(payload, user.id)
  const currentMunicipality =
    typeof profile?.municipality === 'object' ? profile.municipality?.id : profile?.municipality
  // Re-sending the same obec (a retry after onboarding failed to finish) is fine; switching to
  // another one here isn't.
  if (!profile || !pickingAllowed || (currentMunicipality && currentMunicipality !== municipalityId)) {
    return NextResponse.json({ error: 'Obec už je u účtu vybraná.' }, { status: 409 })
  }

  const municipality = await payload
    .findByID({ collection: 'municipalities', id: municipalityId, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!municipality) {
    return NextResponse.json({ error: 'Obec nebyla nalezena.' }, { status: 404 })
  }

  await payload.update({
    collection: 'profiles',
    id: profile.id,
    data: { municipality: municipalityId },
    overrideAccess: true,
  })

  const existingRole = await payload.find({
    collection: 'user-roles',
    where: {
      and: [
        { user: { equals: user.id } },
        { municipality: { equals: municipalityId } },
        { role: { equals: 'participant' } },
      ],
    },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  if (existingRole.docs.length === 0) {
    await payload.create({
      collection: 'user-roles',
      data: { user: user.id, municipality: municipalityId, role: 'participant' },
      overrideAccess: true,
    })
  }

  return NextResponse.json({ ok: true })
}
