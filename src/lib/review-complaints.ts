import type { Payload, PayloadRequest } from 'payload'

import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { eventOrganizerIds } from '@/collections/Events'
import { notDeleted } from '@/collections/shared/softDelete'
import type { Event } from '@/payload-types'

/** The two kinds of review someone can report to the obec: a participant's feedback on an event
 * (about its organizers) and an organizer's rating of a volunteer. */
export type ReviewType = 'event-feedback' | 'volunteer-rating'

export type ReviewComplaintStatus = 'pending' | 'upheld' | 'rejected'

type Viewer = { id: number; role?: string | null }

export type ResolvedReview = {
  type: ReviewType
  id: number
  event: Event
  /** For a volunteer rating, the rated volunteer — the only one who may report it. */
  volunteerId: string | null
}

const relationId = (value: unknown): string | null => {
  if (value == null) return null
  return String(typeof value === 'object' ? (value as { id: unknown }).id : value)
}

/** The review and the event it belongs to — null when it doesn't exist or is already removed. */
export async function resolveReview(
  payload: Payload,
  type: ReviewType,
  reviewId: number | string,
  req?: PayloadRequest,
): Promise<ResolvedReview | null> {
  const findEvent = (id: string | null) =>
    id
      ? payload.findByID({ collection: 'events', id, depth: 0, overrideAccess: true, req }).catch(() => null)
      : Promise.resolve(null)

  if (type === 'event-feedback') {
    const feedback = await payload
      .findByID({ collection: 'event-feedback', id: reviewId, depth: 1, overrideAccess: true, req })
      .catch(() => null)
    if (!feedback || feedback.deletedAt) return null
    const registration = typeof feedback.registration === 'object' ? feedback.registration : null
    const event = await findEvent(relationId(registration?.event))
    return event ? { type, id: feedback.id, event, volunteerId: null } : null
  }

  const rating = await payload
    .findByID({ collection: 'volunteer-ratings', id: reviewId, depth: 0, overrideAccess: true, req })
    .catch(() => null)
  if (!rating || rating.deletedAt) return null
  const event = await findEvent(relationId(rating.event))
  return event ? { type, id: rating.id, event, volunteerId: relationId(rating.volunteer) } : null
}

/** What the viewer's standing is, looked up once for a whole list of reviews. */
export type ComplainantContext = { viewer: Viewer; administeredIds: string[]; ownedOrganizationIds: string[] }

export async function complainantContext(payload: Payload, viewer: Viewer): Promise<ComplainantContext> {
  const [administeredIds, owned] = await Promise.all([
    viewer.role === 'admin' ? Promise.resolve([] as string[]) : getAdministeredMunicipalityIds(payload, viewer.id),
    payload.find({
      collection: 'organizations',
      where: { and: [{ owner: { equals: viewer.id } }, notDeleted] },
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
  ])
  return { viewer, administeredIds, ownedOrganizationIds: owned.docs.map((o) => String(o.id)) }
}

/**
 * Who may report a review to the obec: about event feedback, whoever runs the event — its pořadatel,
 * a spolupořadatel, or the owner of an organization on it; about a volunteer rating, the volunteer.
 * Never the obec the event belongs to, nor a platform admin — they are the ones who decide.
 */
export function mayComplainAbout(review: Pick<ResolvedReview, 'type' | 'event' | 'volunteerId'>, ctx: ComplainantContext): boolean {
  const { viewer, administeredIds, ownedOrganizationIds } = ctx
  if (viewer.role === 'admin') return false
  const municipalityId = relationId(review.event.municipality)
  if (municipalityId !== null && administeredIds.includes(municipalityId)) return false

  const uid = String(viewer.id)
  if (review.type === 'volunteer-rating') return review.volunteerId === uid

  if (eventOrganizerIds(review.event).includes(uid)) return true
  const eventOrganizationIds = [review.event.organization, ...(review.event.coOrganizations ?? [])].map(relationId)
  return eventOrganizationIds.some((id) => id !== null && ownedOrganizationIds.includes(id))
}

/**
 * The state of the complaints about each review — `pending` while the obec hasn't decided,
 * `rejected` once it kept the review. A review the obec removed doesn't show up anywhere anymore,
 * so `upheld` is never reported. A rejected complaint can't be filed again.
 */
export async function complaintStatusByReview(
  payload: Payload,
  type: ReviewType,
  reviewIds: (number | string)[],
  req?: PayloadRequest,
): Promise<Map<string, 'pending' | 'rejected'>> {
  const result = new Map<string, 'pending' | 'rejected'>()
  if (reviewIds.length === 0) return result
  const field = type === 'event-feedback' ? 'eventFeedback' : 'volunteerRating'
  const complaints = await payload.find({
    collection: 'review-complaints',
    where: { and: [{ [field]: { in: reviewIds } }, { status: { in: ['pending', 'rejected'] } }] },
    select: { eventFeedback: true, volunteerRating: true, status: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  for (const c of complaints.docs) {
    const reviewId = relationId(type === 'event-feedback' ? c.eventFeedback : c.volunteerRating)
    if (!reviewId) continue
    // A pending one outweighs an older rejected one (there can't be both, but be safe).
    if (result.get(reviewId) !== 'pending') result.set(reviewId, c.status as 'pending' | 'rejected')
  }
  return result
}
