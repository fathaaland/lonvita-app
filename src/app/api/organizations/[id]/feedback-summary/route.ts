import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { notDeleted } from '@/collections/shared/softDelete'

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

const average = (values: number[]): number | null =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null

const share = (values: boolean[]): number | null =>
  values.length ? values.filter(Boolean).length / values.length : null

/**
 * What the participants said about the events an organization runs or co-organizes — only in
 * aggregate, so the "Organizace" page can show it to the organization's owner without letting
 * them read anyone's individual feedback (EventFeedback stays readable by its author and the obec's
 * admin). For the owner, an admin of the organization's obec and a platform admin.
 *
 * GET /api/organizations/:id/feedback-summary
 * → { count, avg_satisfaction, avg_felt_welcome, met_someone_new_share, came_alone_share }
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const organization = await payload
    .findByID({ collection: 'organizations', id, depth: 0, overrideAccess: true })
    .catch(() => null)
  if (!organization || organization.deletedAt) {
    return NextResponse.json({ error: 'Organizace neexistuje.' }, { status: 404 })
  }

  const isOwner = relationId(organization.owner) === String(user.id)
  const municipalityId = relationId(organization.municipality)
  const allowed =
    user.role === 'admin' ||
    isOwner ||
    (municipalityId !== null && (await getAdministeredMunicipalityIds(payload, user.id)).includes(municipalityId))
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const events = await payload.find({
    collection: 'events',
    where: {
      and: [{ or: [{ organization: { equals: id } }, { coOrganizations: { contains: id } }] }, notDeleted],
    },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    // Only the ids are needed — no reason to also write finished events' status (Events deriveFinishedStatus).
    context: { skipFinishedAutoUpdate: true },
  })
  const eventIds = events.docs.map((e) => e.id)

  const feedback = eventIds.length
    ? (
        await payload.find({
          collection: 'event-feedback',
          where: { and: [{ 'registration.event': { in: eventIds } }, notDeleted] },
          depth: 0,
          pagination: false,
          overrideAccess: true,
        })
      ).docs
    : []

  return NextResponse.json({
    count: feedback.length,
    avg_satisfaction: average(feedback.map((f) => f.satisfactionRating)),
    avg_felt_welcome: average(
      feedback.map((f) => f.feltWelcomeRating).filter((v): v is number => typeof v === 'number'),
    ),
    met_someone_new_share: share(
      feedback.map((f) => f.metSomeoneNew).filter((v): v is boolean => typeof v === 'boolean'),
    ),
    came_alone_share: share(feedback.map((f) => f.cameAlone).filter((v): v is boolean => typeof v === 'boolean')),
  })
}
