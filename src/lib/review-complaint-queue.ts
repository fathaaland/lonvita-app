import type { Payload } from 'payload'

import type { ReviewComplaint } from '@/payload-types'
import { relationNumber } from '@/lib/relations'

/**
 * A queue of complaints about reviews, as whoever decides them reads it — each with the review as it
 * stands (stars, comment, who wrote it), whom it's about and why it was reported, so it can be
 * decided right there. `review` is null once the review itself is gone (its author's account
 * deleted): the complaint can still be closed. Shared by the obec's queue and the platform admin's.
 */
export async function describeComplaintQueue(payload: Payload, complaints: ReviewComplaint[]) {
  if (complaints.length === 0) return []
  const feedbackIds = complaints.map((c) => relationNumber(c.eventFeedback)).filter((v): v is number => v !== null)
  const ratingIds = complaints.map((c) => relationNumber(c.volunteerRating)).filter((v): v is number => v !== null)
  const eventIds = [...new Set(complaints.map((c) => relationNumber(c.event)).filter((v): v is number => v !== null))]

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
    relationNumber(typeof f.registration === 'object' ? f.registration.user : null)
  const userIds = new Set<number>()
  for (const c of complaints) userIds.add(relationNumber(c.complainant)!)
  for (const f of feedback.docs) {
    const author = feedbackAuthor(f)
    if (author) userIds.add(author)
  }
  for (const r of ratings.docs) {
    userIds.add(relationNumber(r.ratedBy)!)
    userIds.add(relationNumber(r.volunteer)!)
  }
  const profiles = await payload.find({
    collection: 'profiles',
    where: { user: { in: [...userIds] } },
    select: { user: true, fullName: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  const nameOf = new Map(profiles.docs.map((p) => [relationNumber(p.user), p.fullName]))
  const name = (userId: number | null, fallback: string) => (userId !== null && nameOf.get(userId)) || fallback

  const docs = complaints.map((c) => {
    const eventId = relationNumber(c.event)
    const event = eventId !== null ? eventById.get(eventId) : undefined
    const organization = event && typeof event.organization === 'object' ? event.organization : null

    let review: { rating: number; comment: string | null; author_name: string; subject_name: string; created_at: string } | null =
      null
    if (c.reviewType === 'volunteer-rating') {
      const r = ratingById.get(relationNumber(c.volunteerRating)!)
      if (r) {
        review = {
          rating: r.rating,
          comment: r.comment?.trim() || null,
          author_name: name(relationNumber(r.ratedBy), 'Pořadatel'),
          subject_name: name(relationNumber(r.volunteer), 'Dobrovolník'),
          created_at: r.createdAt,
        }
      }
    } else {
      const f = feedbackById.get(relationNumber(c.eventFeedback)!)
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
      municipality_id: String(relationNumber(c.municipality)),
      review,
      complainant_name: name(relationNumber(c.complainant), 'Uživatel'),
      reason: c.reason,
      created_at: c.createdAt,
    }
  })

  return docs
}
