import { NextResponse } from 'next/server'
import { getPayload } from 'payload'

import config from '@payload-config'
import { canAccessMunicipality } from '@/lib/exports/access'

const relationId = (value: unknown): number | null =>
  value == null ? null : typeof value === 'object' ? (value as { id: number }).id : (value as number)

/**
 * The obec's queue of complaints about reviews, oldest first — each with the review as it stands
 * (stars, comment, who wrote it), whom it's about and why it was reported, so the admin can decide
 * it right there. `review` is null once the review itself is gone (its author's account deleted):
 * the complaint can still be closed. For the obec's admin or a platform admin.
 *
 * GET /api/municipalities/:id/review-complaints
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canAccessMunicipality(payload, user, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const complaints = await payload.find({
    collection: 'review-complaints',
    where: { and: [{ municipality: { equals: id } }, { status: { equals: 'pending' } }] },
    sort: 'createdAt',
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  if (complaints.docs.length === 0) return NextResponse.json({ docs: [] })

  const feedbackIds = complaints.docs.map((c) => relationId(c.eventFeedback)).filter((v): v is number => v !== null)
  const ratingIds = complaints.docs.map((c) => relationId(c.volunteerRating)).filter((v): v is number => v !== null)
  const eventIds = [...new Set(complaints.docs.map((c) => relationId(c.event)).filter((v): v is number => v !== null))]

  const [feedback, ratings, events] = await Promise.all([
    feedbackIds.length
      ? payload.find({
          collection: 'event-feedback',
          where: { id: { in: feedbackIds } },
          depth: 1,
          pagination: false,
          overrideAccess: true,
        })
      : { docs: [] },
    ratingIds.length
      ? payload.find({
          collection: 'volunteer-ratings',
          where: { id: { in: ratingIds } },
          depth: 0,
          pagination: false,
          overrideAccess: true,
        })
      : { docs: [] },
    eventIds.length
      ? payload.find({
          collection: 'events',
          where: { id: { in: eventIds } },
          select: { title: true, organization: true },
          depth: 1,
          pagination: false,
          overrideAccess: true,
        })
      : { docs: [] },
  ])
  const feedbackById = new Map(feedback.docs.map((f) => [f.id, f]))
  const ratingById = new Map(ratings.docs.map((r) => [r.id, r]))
  const eventById = new Map(events.docs.map((e) => [e.id, e]))

  // Everyone named in the queue, in one lookup: the complainants, the reviews' authors, the volunteers.
  const feedbackAuthor = (f: (typeof feedback.docs)[number]) =>
    relationId(typeof f.registration === 'object' ? f.registration.user : null)
  const userIds = new Set<number>()
  for (const c of complaints.docs) userIds.add(relationId(c.complainant)!)
  for (const f of feedback.docs) {
    const author = feedbackAuthor(f)
    if (author) userIds.add(author)
  }
  for (const r of ratings.docs) {
    userIds.add(relationId(r.ratedBy)!)
    userIds.add(relationId(r.volunteer)!)
  }
  const profiles = await payload.find({
    collection: 'profiles',
    where: { user: { in: [...userIds] } },
    select: { user: true, fullName: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const nameOf = new Map(profiles.docs.map((p) => [relationId(p.user), p.fullName]))
  const name = (userId: number | null, fallback: string) => (userId !== null && nameOf.get(userId)) || fallback

  const docs = complaints.docs.map((c) => {
    const eventId = relationId(c.event)
    const event = eventId !== null ? eventById.get(eventId) : undefined
    const organization = event && typeof event.organization === 'object' ? event.organization : null

    let review: { rating: number; comment: string | null; author_name: string; subject_name: string; created_at: string } | null =
      null
    if (c.reviewType === 'volunteer-rating') {
      const r = ratingById.get(relationId(c.volunteerRating)!)
      if (r) {
        review = {
          rating: r.rating,
          comment: r.comment?.trim() || null,
          author_name: name(relationId(r.ratedBy), 'Pořadatel'),
          subject_name: name(relationId(r.volunteer), 'Dobrovolník'),
          created_at: r.createdAt,
        }
      }
    } else {
      const f = feedbackById.get(relationId(c.eventFeedback)!)
      if (f) {
        review = {
          rating: f.satisfactionRating,
          comment: f.comment?.trim() || null,
          author_name: name(feedbackAuthor(f), 'Účastník'),
          subject_name: organization?.name ?? 'Pořadatel',
          created_at: f.createdAt,
        }
      }
    }

    return {
      id: String(c.id),
      review_type: c.reviewType,
      event_id: eventId !== null ? String(eventId) : null,
      event_title: event?.title ?? 'Smazaná akce',
      review,
      complainant_name: name(relationId(c.complainant), 'Uživatel'),
      reason: c.reason,
      created_at: c.createdAt,
    }
  })

  return NextResponse.json({ docs })
}
