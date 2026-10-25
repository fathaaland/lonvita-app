import type { Payload, PayloadRequest } from 'payload'

import { getAdministeredMunicipalityIds } from '@/collections/access/shared'
import { MUNICIPALITY_ORGANIZATION_TYPE } from '@/lib/organizations'
import type { Event } from '@/payload-types'
import { relationId } from '@/lib/relations'

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

/** The organization of each obec (by id) — what tells an event the obec runs. */
async function obecOrganizationIds(payload: Payload, municipalityIds: string[], req?: PayloadRequest): Promise<Map<string, string>> {
  if (municipalityIds.length === 0) return new Map()
  const found = await payload.find({
    collection: 'organizations',
    where: { and: [{ municipality: { in: municipalityIds } }, { type: { equals: MUNICIPALITY_ORGANIZATION_TYPE } }] },
    select: { municipality: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  return new Map(found.docs.map((o) => [relationId(o.municipality)!, String(o.id)]))
}

/** What the viewer's standing is, looked up once for a whole list of reviews. */
export type ComplainantContext = { viewer: Viewer; administeredIds: string[]; obecOrganizations: Map<string, string> }

export async function complainantContext(payload: Payload, viewer: Viewer): Promise<ComplainantContext> {
  const administeredIds = viewer.role === 'admin' ? [] : await getAdministeredMunicipalityIds(payload, viewer.id)
  return { viewer, administeredIds, obecOrganizations: await obecOrganizationIds(payload, administeredIds) }
}

/**
 * Who may report a review: about event feedback, the event's creator alone — its pořadatel, or the
 * obec's admins when the obec runs it (Events isEventCreator) — not a spolupořadatel, so a
 * co-organized event's reviews have one voice; about a volunteer rating, the volunteer. Never a
 * platform admin — they decide whenever the obec itself is a party (decidedByPlatform).
 */
export function mayComplainAbout(review: Pick<ResolvedReview, 'type' | 'event' | 'volunteerId'>, ctx: ComplainantContext): boolean {
  const { viewer, administeredIds, obecOrganizations } = ctx
  if (viewer.role === 'admin') return false
  if (review.type === 'volunteer-rating') return review.volunteerId === String(viewer.id)

  if (relationId(review.event.organizer) === String(viewer.id)) return true
  const municipalityId = relationId(review.event.municipality)
  if (municipalityId === null || !administeredIds.includes(municipalityId)) return false
  const obecOrganizationId = obecOrganizations.get(municipalityId)
  return obecOrganizationId !== undefined && relationId(review.event.organization) === obecOrganizationId
}

type ComplaintParties = { municipality: unknown; event?: unknown; complainant: unknown }

/**
 * Of `complaints`, the ids the obec can't decide because it's a party to them: the event is the
 * obec's own (the review is about the obec, or the rating came from its admin), or one of its admins
 * complained. Nobody decides their own case — the platform admin does.
 */
export async function complaintsDecidedByPlatform(
  payload: Payload,
  complaints: (ComplaintParties & { id: number | string })[],
  req?: PayloadRequest,
): Promise<Set<string>> {
  if (complaints.length === 0) return new Set()
  const municipalityIds = [...new Set(complaints.map((c) => relationId(c.municipality)).filter((id): id is string => id !== null))]
  const eventIds = [...new Set(complaints.map((c) => relationId(c.event)).filter((id): id is string => id !== null))]
  const [obecOrganizations, events, admins] = await Promise.all([
    obecOrganizationIds(payload, municipalityIds, req),
    eventIds.length
      ? payload.find({
          collection: 'events',
          where: { id: { in: eventIds } },
          select: { organization: true },
          depth: 0,
          pagination: false,
          overrideAccess: true,
          req,
        })
      : Promise.resolve({ docs: [] as Pick<Event, 'id' | 'organization'>[] }),
    payload.find({
      collection: 'user-roles',
      where: { and: [{ municipality: { in: municipalityIds } }, { role: { equals: 'municipality_admin' } }] },
      select: { user: true, municipality: true },
      depth: 0,
      pagination: false,
      overrideAccess: true,
      req,
    }),
  ])
  const organizationOf = new Map(events.docs.map((e) => [String(e.id), relationId(e.organization)]))
  const adminOf = new Set(admins.docs.map((r) => `${relationId(r.municipality)}:${relationId(r.user)}`))

  const result = new Set<string>()
  for (const c of complaints) {
    const municipalityId = relationId(c.municipality)
    if (municipalityId === null) continue
    const eventId = relationId(c.event)
    const obecRunsIt =
      eventId !== null && obecOrganizations.has(municipalityId) && organizationOf.get(eventId) === obecOrganizations.get(municipalityId)
    if (obecRunsIt || adminOf.has(`${municipalityId}:${relationId(c.complainant)}`)) result.add(String(c.id))
  }
  return result
}

/**
 * Who would decide the viewer's complaint about each review — `true` where it's the platform admin
 * (complaintsDecidedByPlatform: the obec runs the event, or the viewer is its admin), so the review
 * can say "správce Lonvity" rather than "obec". Keyed by review id.
 */
export async function reviewsDecidedByPlatform(
  payload: Payload,
  reviews: { id: number | string; event: { id: number | string; municipality?: unknown } }[],
  viewerId: number | string,
): Promise<Set<string>> {
  return complaintsDecidedByPlatform(
    payload,
    reviews.map((r) => ({ id: r.id, municipality: r.event.municipality, event: r.event.id, complainant: viewerId })),
  )
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
