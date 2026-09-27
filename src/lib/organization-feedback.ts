import type { Payload } from 'payload'

import { notDeleted } from '@/collections/shared/softDelete'

import type { OrganizationFeedbackSummary } from './organization-stats'

const average = (values: number[]): number | null =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null

const share = (values: boolean[]): number | null =>
  values.length ? values.filter(Boolean).length / values.length : null

/** Aggregate feedback over every event the organization runs or co-organizes — nobody's single
 * answer. Server-side only (overrideAccess): callers check who may see it. Shared by
 * GET /api/organizations/:id/feedback-summary and the worker's organization PDF. */
export async function summarizeOrganizationFeedback(
  payload: Payload,
  organizationId: number | string,
): Promise<OrganizationFeedbackSummary> {
  const events = await payload.find({
    collection: 'events',
    where: {
      and: [{ or: [{ organization: { equals: organizationId } }, { coOrganizations: { contains: organizationId } }] }, notDeleted],
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

  return {
    count: feedback.length,
    avg_satisfaction: average(feedback.map((f) => f.satisfactionRating)),
    avg_felt_welcome: average(
      feedback.map((f) => f.feltWelcomeRating).filter((v): v is number => typeof v === 'number'),
    ),
    met_someone_new_share: share(
      feedback.map((f) => f.metSomeoneNew).filter((v): v is boolean => typeof v === 'boolean'),
    ),
    came_alone_share: share(feedback.map((f) => f.cameAlone).filter((v): v is boolean => typeof v === 'boolean')),
  }
}
